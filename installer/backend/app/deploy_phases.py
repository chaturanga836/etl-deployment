"""Deploy phase labels and progress for the setup wizard."""

from __future__ import annotations

import re
from typing import Any

PHASES: dict[str, dict[str, Any]] = {
    "starting": {"label": "Starting installation", "progress": 5},
    "prepare": {"label": "Preparing server", "progress": 10},
    "render": {"label": "Generating configuration", "progress": 15},
    "deploy": {"label": "Pulling images and starting services", "progress": 25},
    "database": {"label": "Starting database", "progress": 32},
    "redis": {"label": "Starting Redis", "progress": 36},
    "minio": {"label": "Starting object storage", "progress": 40},
    "centrifugo": {"label": "Starting realtime broker", "progress": 44},
    "keycloak": {"label": "Deploying Keycloak", "progress": 50},
    "api": {"label": "Starting API", "progress": 58},
    "worker": {"label": "Starting background workers", "progress": 65},
    "frontend": {"label": "Starting web application", "progress": 70},
    "proxy": {"label": "Configuring reverse proxy", "progress": 75},
    "bootstrap": {"label": "Configuring platform", "progress": 80},
    "bootstrap_keycloak": {"label": "Setting up authentication", "progress": 85},
    "bootstrap_admin": {"label": "Creating administrator account", "progress": 90},
    "finalize": {"label": "Finalizing installation", "progress": 95},
    "complete": {"label": "Installation complete", "progress": 100},
    "upgrade_starting": {"label": "Starting upgrade", "progress": 5},
    "upgrade_sync": {"label": "Syncing release version", "progress": 15},
    "upgrade_pull": {"label": "Pulling new images", "progress": 40},
    "upgrade_recreate": {"label": "Recreating services", "progress": 70},
    "upgrade_health": {"label": "Verifying platform health", "progress": 90},
    "upgrade_complete": {"label": "Upgrade complete", "progress": 100},
}

_LOG_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"elt-postgres", re.I), "database"),
    (re.compile(r"elt-redis", re.I), "redis"),
    (re.compile(r"platform-shared-minio-storage", re.I), "minio"),
    (re.compile(r"platform-shared-centrifugo", re.I), "centrifugo"),
    (re.compile(r"elt-keycloak|keycloak realm bootstrap", re.I), "keycloak"),
    (re.compile(r"dt-orch-api\b", re.I), "api"),
    (re.compile(r"dt-orch-worker", re.I), "worker"),
    (re.compile(r"dt-orch-frontend", re.I), "frontend"),
    (re.compile(r"elt-proxy|baas-infra", re.I), "proxy"),
    (re.compile(r"bootstrap-keycloak-realm", re.I), "bootstrap_keycloak"),
    (re.compile(r"bootstrap-superadmin", re.I), "bootstrap_admin"),
    (re.compile(r"setup/complete|Health check passed|MinIO health|Centrifugo health", re.I), "finalize"),
    (re.compile(r"Upgrading to image tag", re.I), "upgrade_sync"),
    (re.compile(r"Pulling images", re.I), "upgrade_pull"),
    (re.compile(r"Recreating services", re.I), "upgrade_recreate"),
    (re.compile(r"Waiting for API health|All health checks passed|Upgrade complete", re.I), "upgrade_health"),
]


def phase_payload(key: str, *, label: str | None = None, progress: int | None = None) -> dict[str, Any]:
    meta = PHASES.get(key, {})
    return {
        "key": key,
        "label": label or meta.get("label", key.replace("_", " ").title()),
        "progress": progress if progress is not None else meta.get("progress", 0),
    }


def phase_from_log_line(line: str) -> dict[str, Any] | None:
    for pattern, key in _LOG_PATTERNS:
        if pattern.search(line):
            return phase_payload(key)
    return None
