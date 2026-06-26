"""Read vendor release defaults from etl-deployment/VERSION."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

_DEFAULT_REGISTRY = "ghcr.io/chaturanga836"
_DEFAULT_PLATFORM = "1.0.0"
_IMAGE_NAMES = {
    "api": "dt-orch-api",
    "frontend": "dt-orch-frontend",
    "infra": "baas-infra",
    "scraper": "dt-orch-scraper",
}


def _deployment_root() -> Path:
    return Path(os.getenv("ETL_DEPLOYMENT_ROOT", "/opt/etl-deployment"))


def _parse_version_file(path: Path) -> tuple[str, str]:
    platform = _DEFAULT_PLATFORM
    registry_url = _DEFAULT_REGISTRY
    in_registry = False

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("platform:"):
            platform = line.split(":", 1)[1].strip().strip("\"'")
        elif line.startswith("registry:"):
            in_registry = True
        elif in_registry and line.startswith("url:"):
            registry_url = line.split(":", 1)[1].strip().strip("\"'")
            in_registry = False
        elif re.match(r"^[a-z_]+:", line):
            in_registry = False

    if registry_url == "ghcr.io/YOUR_GITHUB_ORG":
        registry_url = _DEFAULT_REGISTRY

    return platform, registry_url


def _platform_to_tag(platform: str) -> str:
    platform = (platform or _DEFAULT_PLATFORM).strip()
    return platform if platform.startswith("v") else f"v{platform}"


def load_install_defaults() -> dict[str, Any]:
    root = _deployment_root()
    version_file = root / "VERSION"
    platform = _DEFAULT_PLATFORM
    registry_url = _DEFAULT_REGISTRY

    if version_file.is_file():
        platform, registry_url = _parse_version_file(version_file)

    image_tag = _platform_to_tag(platform)
    images = [
        {"role": role, "name": name, "reference": f"{registry_url}/{name}:{image_tag}"}
        for role, name in _IMAGE_NAMES.items()
    ]

    return {
        "app_name": "DT Orch",
        "platform_version": platform,
        "registry_url": registry_url,
        "image_tag": image_tag,
        "images": images,
        "end_user_managed": True,
        "description": (
            "Official DT Orch release packages for this installer. "
            "No registry configuration is required for a standard install."
        ),
    }
