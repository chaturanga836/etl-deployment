"""Check Docker, Compose, Helm, kubectl availability."""

from __future__ import annotations

import shutil
import subprocess
from typing import Any


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


def check_prerequisites() -> dict[str, Any]:
    docker = _run_version(["docker", "version", "--format", "{{.Server.Version}}"])
    compose = _run_version(["docker", "compose", "version", "--short"])
    helm = _run_version(["helm", "version", "--short"])
    kubectl = _run_version(["kubectl", "version", "--client", "--short"])

    return {
        "docker": {"available": docker is not None, "version": docker},
        "compose": {"available": compose is not None, "version": compose},
        "helm": {"available": helm is not None, "version": helm},
        "kubectl": {"available": kubectl is not None, "version": kubectl},
        "docker_socket": shutil.which("docker") is not None,
    }
