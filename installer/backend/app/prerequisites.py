"""Check Docker, Compose, Helm, kubectl availability."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.release_manifest import load_install_defaults


def _run_version(cmd: list[str]) -> str | None:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            return None
        return (result.stdout or result.stderr or "").strip().split("\n")[0]
    except (OSError, subprocess.TimeoutExpired):
        return None


def _registry_probe(image: str) -> tuple[bool, str | None]:
    """Return (accessible, error_code). error_code: denied | not_found | unreachable | None."""
    try:
        result = subprocess.run(
            ["docker", "manifest", "inspect", image],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode == 0:
            return True, None
        combined = (result.stderr or result.stdout or "").lower()
        if "denied" in combined or "unauthorized" in combined:
            return False, "denied"
        if "not found" in combined or "manifest unknown" in combined:
            return False, "not_found"
        return False, "unreachable"
    except (OSError, subprocess.TimeoutExpired):
        return False, "unreachable"


def check_prerequisites() -> dict[str, Any]:
    docker = _run_version(["docker", "version", "--format", "{{.Server.Version}}"])
    compose = _run_version(["docker", "compose", "version", "--short"])
    helm = _run_version(["helm", "version", "--short"])
    kubectl = _run_version(["kubectl", "version", "--client", "--short"])

    defaults = load_install_defaults()
    registry_url = defaults["registry_url"]
    registry_public = defaults.get("registry_public", True)
    image_tag = defaults["image_tag"]
    registry_url = defaults["registry_url"].rstrip("/")
    image_names = ("dt-orch-api", "dt-orch-frontend", "baas-infra", "dt-orch-scraper")
    images = {name: f"{registry_url}/{name}:{image_tag}" for name in image_names}
    local_build = Path("/opt/etl-back/Dockerfile").is_file()

    registry_images: dict[str, dict[str, Any]] = {}
    registry_ok: bool | None = None
    registry_error: str | None = None
    if docker is not None and not local_build:
        for name, ref in images.items():
            ok, err = _registry_probe(ref)
            registry_images[name] = {"image": ref, "accessible": ok, "error": err}
            if not ok:
                registry_ok = False
                registry_error = registry_error or err or "not_found"
        if registry_ok is None:
            registry_ok = True

    return {
        "docker": {"available": docker is not None, "version": docker},
        "compose": {"available": compose is not None, "version": compose},
        "helm": {"available": helm is not None, "version": helm},
        "kubectl": {"available": kubectl is not None, "version": kubectl},
        "docker_socket": shutil.which("docker") is not None,
        "registry": {
            "url": registry_url,
            "api_image": images["dt-orch-api"],
            "images": registry_images,
            "accessible": registry_ok,
            "public": registry_public,
            "error": registry_error,
            "local_build": local_build,
        },
    }
