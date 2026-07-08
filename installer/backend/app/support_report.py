"""Collect install diagnostics for end-user support."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.jobs import JobStatus, list_jobs
from app.orchestrator import STATE_DIR, _resolve_env_path
from app.prerequisites import check_prerequisites
from app.release_manifest import load_install_defaults, load_platform_release


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _docker_ps() -> str:
    try:
        result = subprocess.run(
            ["docker", "ps", "-a", "--format", "table {{.Names}}\t{{.Status}}\t{{.Image}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        return (result.stdout or result.stderr or "").strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def _container_logs(name: str, lines: int = 80) -> str:
    try:
        result = subprocess.run(
            ["docker", "logs", name, "--tail", str(lines)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return (result.stdout or "") + (result.stderr or "")
    except (OSError, subprocess.TimeoutExpired):
        return ""


def _health_check() -> dict[str, Any]:
    import httpx

    out: dict[str, Any] = {"ok": False}
    for url in ("http://localhost/health", "http://127.0.0.1:8000/health"):
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(url)
                out = {"ok": resp.status_code == 200, "url": url, "status": resp.status_code}
                if resp.status_code == 200:
                    return out
        except httpx.HTTPError as exc:
            out = {"ok": False, "url": url, "error": str(exc)}
    return out


def build_support_report() -> dict[str, Any]:
    deployment_root = Path(os.getenv("ETL_DEPLOYMENT_ROOT", "/opt/etl-deployment"))
    platform, image_tag = load_platform_release()
    defaults = load_install_defaults()

    failed_jobs = [
        {
            "job_id": job.id,
            "status": job.status.value,
            "error": job.error,
            "log_tail": job.log_lines[-120:],
        }
        for job in list_jobs()
        if job.status == JobStatus.FAILED
    ]

    env_path = _resolve_env_path()
    env_snapshot: dict[str, str] = {}
    if env_path and env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if key in ("POSTGRES_PASSWORD", "FERNET_KEY", "LICENSE_KEY", "INSTALL_BOOTSTRAP_TOKEN"):
                env_snapshot[key] = "<redacted>"
            elif key.endswith("_IMAGE") or key in ("IMAGE_TAG", "REGISTRY_URL", "APP_URL", "DATABASE_URL"):
                env_snapshot[key] = val.strip().strip('"')

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "product": "DT Orch Setup Wizard",
        "platform_version": platform,
        "image_tag": image_tag,
        "registry_url": defaults.get("registry_url"),
        "install_state": _read_json(STATE_DIR / "install-state.json"),
        "install_failure": _read_json(STATE_DIR / "install-failure.json"),
        "failed_jobs_in_memory": failed_jobs,
        "prerequisites": check_prerequisites(),
        "health": _health_check(),
        "docker_ps": _docker_ps(),
        "api_logs_tail": _container_logs("dt-orch-api"),
        "worker_logs_tail": _container_logs("dt-orch-worker"),
        "env_snapshot": env_snapshot,
        "deployment_git": _deployment_git_info(deployment_root),
    }


def _deployment_git_info(root: Path) -> dict[str, str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        commit = (result.stdout or "").strip() if result.returncode == 0 else ""
        return {"path": str(root), "commit": commit}
    except OSError:
        return {"path": str(root), "commit": ""}


def write_install_failure(job_id: str, error: str, log_tail: list[str]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "failed_at": datetime.now(timezone.utc).isoformat(),
        "job_id": job_id,
        "error": error,
        "log_tail": log_tail[-200:],
    }
    (STATE_DIR / "install-failure.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )


def clear_install_failure() -> None:
    path = STATE_DIR / "install-failure.json"
    if path.is_file():
        path.unlink()
