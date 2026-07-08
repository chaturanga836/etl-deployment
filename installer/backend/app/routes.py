"""Installer API routes."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

# Shared license validator
_SHARED = Path(__file__).resolve().parents[2] / "shared"
if str(_SHARED.parent) not in sys.path:
    sys.path.insert(0, str(_SHARED.parent))

from shared.license import issue_trial_license, resolve_license_key, validate_license_key  # noqa: E402

from app.host_info import detect_public_host  # noqa: E402
from app.jobs import JobStatus, create_job, get_job  # noqa: E402
from app.orchestrator import STATE_DIR, _resolve_env_path, _read_env_value, run_deploy_job, run_upgrade_job  # noqa: E402
from app.prerequisites import check_prerequisites  # noqa: E402
from app.release_manifest import compare_versions, load_install_defaults, load_platform_release  # noqa: E402
from app.support_report import build_support_report  # noqa: E402

router = APIRouter(prefix="/api")


class DatabaseValidateRequest(BaseModel):
    host: str
    port: int = 5432
    user: str
    password: str
    database: str = "postgres"


class LicenseValidateRequest(BaseModel):
    key: str


class DeployRequest(BaseModel):
    deployment_mode: str = "monolith"
    registry_url: str = "ghcr.io/YOUR_GITHUB_ORG"
    image_tag: str = "v1.0.0"
    app_name: str = "DT Orch"
    sandbox_enabled: bool = True
    superadmin_username: str = Field(..., min_length=3)
    superadmin_password: str = Field(..., min_length=8)
    superadmin_email: str | None = None
    license_key: str = ""
    database: dict[str, Any] = Field(default_factory=dict)
    monolith: dict[str, Any] = Field(default_factory=dict)
    distributed: dict[str, Any] = Field(default_factory=dict)
    kubernetes: dict[str, Any] = Field(default_factory=dict)
    ssh: dict[str, Any] = Field(default_factory=dict)
    kc_realm: str = "workspace-realm"
    kc_admin_user: str = "admin"
    kc_admin_password: str | None = None


@router.get("/install-defaults")
def install_defaults() -> dict[str, Any]:
    return load_install_defaults()


@router.get("/prerequisites")
def prerequisites() -> dict[str, Any]:
    return check_prerequisites()


@router.get("/support-report")
def support_report() -> dict[str, Any]:
    """Diagnostics bundle for end users to send when install fails."""
    return build_support_report()


@router.get("/install-state")
def install_state() -> dict[str, Any]:
    path = STATE_DIR / "install-state.json"
    if not path.is_file():
        return {"installed": False}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"installed": True, **data}


@router.get("/upgrade-info")
def upgrade_info() -> dict[str, Any]:
    state_path = STATE_DIR / "install-state.json"
    if not state_path.is_file():
        return {"installed": False, "upgrade_available": False}

    env_path = _resolve_env_path()
    if env_path is None:
        return {"installed": False, "upgrade_available": False}

    platform_version, available_tag = load_platform_release()
    current_tag = _read_env_value(env_path, "IMAGE_TAG") or "v1.0.0"
    login_url = json.loads(state_path.read_text(encoding="utf-8")).get("login_url")

    if not login_url:
        app_url = _read_env_value(env_path, "APP_URL")
        if app_url:
            login_url = f"{app_url.rstrip('/')}/login"

    return {
        "installed": True,
        "current_tag": current_tag,
        "available_tag": available_tag,
        "platform_version": platform_version,
        "upgrade_available": compare_versions(current_tag, available_tag) < 0,
        "login_url": login_url,
    }


@router.post("/upgrade")
async def start_upgrade() -> dict[str, str]:
    info = upgrade_info()
    if not info.get("installed"):
        raise HTTPException(status_code=400, detail="No installation found (.env missing).")
    if not info.get("upgrade_available"):
        raise HTTPException(
            status_code=400,
            detail=f"Already on {info.get('current_tag')}; no newer release available.",
        )

    job = create_job()
    asyncio.create_task(run_upgrade_job(job))
    return {"job_id": job.id}


@router.post("/validate/database")
def validate_database(body: DatabaseValidateRequest) -> dict[str, str]:
    try:
        import psycopg2

        conn = psycopg2.connect(
            host=body.host,
            port=body.port,
            user=body.user,
            password=body.password,
            dbname=body.database,
            connect_timeout=8,
        )
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/host-info")
def host_info() -> dict[str, Any]:
    return detect_public_host()


@router.post("/license/trial")
def create_trial_license() -> dict[str, Any]:
    try:
        token = issue_trial_license()
        info = validate_license_key(token)
        return {
            "license_key": token,
            "customer_id": info.customer_id,
            "edition": info.edition,
            "expires_at": info.expires_at.isoformat() if info.expires_at else None,
            "trial_days": 90,
        }
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/validate/license")
def validate_license(body: LicenseValidateRequest) -> dict[str, Any]:
    try:
        info = validate_license_key(body.key)
        return {
            "status": "ok",
            "customer_id": info.customer_id,
            "edition": info.edition,
            "expires_at": info.expires_at.isoformat() if info.expires_at else None,
        }
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _apply_install_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    defaults = load_install_defaults()
    if not payload.get("registry_url") or payload["registry_url"] == "ghcr.io/YOUR_GITHUB_ORG":
        payload["registry_url"] = defaults["registry_url"]
    if not payload.get("image_tag"):
        payload["image_tag"] = defaults["image_tag"]
    if not payload.get("app_name"):
        payload["app_name"] = defaults["app_name"]
    return payload


@router.post("/deploy")
async def start_deploy(body: DeployRequest) -> dict[str, str]:
    try:
        license_key = resolve_license_key(body.license_key)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = create_job()
    payload = _apply_install_defaults(body.model_dump())
    payload["license_key"] = license_key
    asyncio.create_task(run_deploy_job(job, payload))
    return {"job_id": job.id}


@router.get("/deploy/{job_id}/status")
def deploy_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.id,
        "status": job.status.value,
        "login_url": job.login_url,
        "error": job.error,
    }


@router.get("/deploy/{job_id}/events")
async def deploy_events(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        while True:
            if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED) and job.events.empty():
                break
            try:
                item = await asyncio.wait_for(job.events.get(), timeout=1.0)
                yield {
                    "event": item.get("event", "log"),
                    "data": json.dumps(item["data"]) if isinstance(item.get("data"), dict) else item.get("data", ""),
                }
            except asyncio.TimeoutError:
                if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                    break
                continue

    return EventSourceResponse(event_generator())
