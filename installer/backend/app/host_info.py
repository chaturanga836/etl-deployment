"""Detect public host info for EC2 / bare-metal installs."""

from __future__ import annotations

import os
import re
import socket
from typing import Any

import httpx

_METADATA_BASE = "http://169.254.169.254"
_METADATA = f"{_METADATA_BASE}/latest/meta-data"
_METADATA_TIMEOUT = 2.0

# Docker default container hostnames are 12-char hex IDs.
_DOCKER_HOSTNAME = re.compile(r"^[0-9a-f]{12}$", re.I)


def _ec2_metadata_token() -> str | None:
    try:
        with httpx.Client(timeout=_METADATA_TIMEOUT) as client:
            r = client.put(
                f"{_METADATA_BASE}/latest/api/token",
                headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
            )
            if r.status_code == 200 and r.text.strip():
                return r.text.strip()
    except Exception:
        pass
    return None


def _ec2_metadata(path: str) -> str | None:
    token = _ec2_metadata_token()
    headers = {"X-aws-ec2-metadata-token": token} if token else {}
    try:
        with httpx.Client(timeout=_METADATA_TIMEOUT) as client:
            r = client.get(f"{_METADATA}/{path}", headers=headers)
            if r.status_code == 200 and r.text.strip():
                return r.text.strip()
            if token:
                r = client.get(f"{_METADATA}/{path}")
                if r.status_code == 200 and r.text.strip():
                    return r.text.strip()
    except Exception:
        pass
    return None


def _usable_hostname(name: str | None) -> bool:
    if not name or name in ("localhost", "127.0.0.1"):
        return False
    if _DOCKER_HOSTNAME.match(name):
        return False
    return True


def _is_public_facing_hostname(name: str | None) -> bool:
    if not _usable_hostname(name):
        return False
    lower = name.lower()
    if lower.endswith(".compute.internal"):
        return False
    if lower.startswith("ip-172-") or lower.startswith("ip-10-") or lower.startswith("ip-192-168-"):
        return False
    return True


def _resolve_access_host(
    *,
    override: str,
    public_ipv4: str | None,
    public_dns: str | None,
    local_hostname: str,
) -> str:
    if override and _is_public_facing_hostname(override):
        return override
    if public_ipv4:
        return public_ipv4
    if public_dns and _is_public_facing_hostname(public_dns):
        return public_dns
    if override:
        return override
    if _usable_hostname(local_hostname):
        return local_hostname
    return "localhost"


def detect_public_host() -> dict[str, Any]:
    """Best-effort public hostname/IP for URLs shown to end users."""
    override = (os.getenv("INSTALLER_PUBLIC_HOST") or os.getenv("PUBLIC_HOST") or "").strip()

    public_ipv4 = _ec2_metadata("public-ipv4")
    public_dns = _ec2_metadata("public-hostname")
    local_hostname = socket.gethostname()

    host = _resolve_access_host(
        override=override,
        public_ipv4=public_ipv4,
        public_dns=public_dns,
        local_hostname=local_hostname,
    )

    installer_port = int(os.getenv("INSTALLER_PORT", "3000"))
    platform_port = int(os.getenv("PLATFORM_HTTP_PORT", "80"))

    scheme = "http"
    installer_url = f"{scheme}://{host}:{installer_port}"
    if platform_port in (80, 443):
        platform_url = f"{scheme}://{host}" + ("" if platform_port == 80 else f":{platform_port}")
    else:
        platform_url = f"{scheme}://{host}:{platform_port}"

    return {
        "public_ipv4": public_ipv4,
        "public_dns": public_dns,
        "local_hostname": local_hostname,
        "suggested_public_host": host,
        "installer_port": installer_port,
        "platform_http_port": platform_port,
        "installer_url": installer_url,
        "platform_url": platform_url,
        "security_group_ports": [installer_port, platform_port],
        "host_detection_note": (
            "Using private EC2 hostname — set Public host to your public IP in the Config step."
            if ".compute.internal" in host or host.startswith("ip-172-")
            else (
                "Set INSTALLER_PUBLIC_HOST to your server public IP/DNS if URLs look wrong."
                if host == "localhost" and not override
                else None
            )
        ),
    }
