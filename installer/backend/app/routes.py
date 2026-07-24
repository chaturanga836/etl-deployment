"""Installer API routes."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.host_info import detect_public_host
from app.jobs import JobStatus, create_job, get_active_job, get_job, job_snapshot
from app.orchestrator import run_deploy_job, run_upgrade_job
from app.prerequisites import check_prerequisites
from app.release_manifest import compare_versions, load_install_defaults, load_platform_release
from app.state import STATE_DIR, read_env_value, resolve_env_path
from app.support_report import build_support_report

router = APIRouter(prefix="/api")


class DatabaseValidateRequest(BaseModel):
    host: str
    port: int = 5432
    user: str
    password: str
    database: str = "postgres"
    engine: str = "postgres"


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
    workspace_sql: dict[str, Any] = Field(default_factory=dict)
    mongo: dict[str, Any] = Field(default_factory=dict)
    keycloak: dict[str, Any] = Field(default_factory=dict)
    redis: dict[str, Any] = Field(default_factory=dict)
    minio: dict[str, Any] = Field(default_factory=dict)
    centrifugo: dict[str, Any] = Field(default_factory=dict)
    grafana: dict[str, Any] = Field(default_factory=dict)
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

    env_path = resolve_env_path()
    if env_path is None:
        return {"installed": False, "upgrade_available": False}

    platform_version, available_tag = load_platform_release()
    current_tag = read_env_value(env_path, "IMAGE_TAG") or "v1.0.0"
    login_url = json.loads(state_path.read_text(encoding="utf-8")).get("login_url")

    if not login_url:
        app_url = read_env_value(env_path, "APP_URL")
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

    job = create_job(kind="upgrade")
    asyncio.create_task(run_upgrade_job(job))
    return {"job_id": job.id}


@router.post("/validate/database")
def validate_database(body: DatabaseValidateRequest) -> dict[str, str]:
    engine = (body.engine or "postgres").strip().lower()
    try:
        if engine == "mysql":
            import pymysql

            conn = pymysql.connect(
                host=body.host,
                port=body.port,
                user=body.user,
                password=body.password,
                database=body.database if body.database != "postgres" else None,
                connect_timeout=8,
            )
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            conn.close()
            return {"status": "ok"}

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
    job = create_job()
    payload = _apply_install_defaults(body.model_dump())
    # Platform is freely available — no license or trial key.
    payload["license_key"] = ""
    asyncio.create_task(run_deploy_job(job, payload))
    return {"job_id": job.id}


@router.get("/deploy/active")
def active_deploy() -> dict[str, Any]:
    job = get_active_job()
    if not job:
        return {"active": False}
    return {"active": True, **job_snapshot(job)}


@router.get("/deploy/{job_id}/status")
def deploy_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_snapshot(job)


@router.get("/deploy/{job_id}/events")
async def deploy_events(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        for line in job.log_lines:
            yield {"event": "log", "data": line}
        if job.current_phase:
            yield {
                "event": "phase",
                "data": json.dumps(job.current_phase),
            }
        if job.status == JobStatus.SUCCEEDED:
            yield {
                "event": "complete",
                "data": json.dumps({"login_url": job.login_url}),
            }
            return
        if job.status == JobStatus.FAILED:
            yield {"event": "error", "data": job.error or "Installation failed"}
            return

        while not job.events.empty():
            job.events.get_nowait()

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
