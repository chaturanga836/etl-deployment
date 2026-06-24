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

from shared.license import validate_license_key  # noqa: E402

from app.jobs import JobStatus, create_job, get_job
from app.orchestrator import STATE_DIR, run_deploy_job
from app.prerequisites import check_prerequisites

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
    license_key: str
    database: dict[str, Any] = Field(default_factory=dict)
    monolith: dict[str, Any] = Field(default_factory=dict)
    distributed: dict[str, Any] = Field(default_factory=dict)
    kubernetes: dict[str, Any] = Field(default_factory=dict)
    ssh: dict[str, Any] = Field(default_factory=dict)
    kc_realm: str = "workspace-realm"
    kc_admin_user: str = "admin"
    kc_admin_password: str | None = None


@router.get("/prerequisites")
def prerequisites() -> dict[str, Any]:
    return check_prerequisites()


@router.get("/install-state")
def install_state() -> dict[str, Any]:
    path = STATE_DIR / "install-state.json"
    if not path.is_file():
        return {"installed": False}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"installed": True, **data}


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


@router.post("/deploy")
async def start_deploy(body: DeployRequest) -> dict[str, str]:
    try:
        validate_license_key(body.license_key)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = create_job()
    payload = body.model_dump()
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
                    "data": json.dumps(item.get("data")) if not isinstance(item.get("data"), str) else item["data"],
                }
            except asyncio.TimeoutError:
                if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                    break
                continue

    return EventSourceResponse(event_generator())
