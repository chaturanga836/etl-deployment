"""Detect public host info for EC2 / bare-metal installs."""

from __future__ import annotations

import os
import socket
from typing import Any

import httpx

_METADATA = "http://169.254.169.254/latest/meta-data"
_METADATA_TIMEOUT = 1.5


def _ec2_metadata(path: str) -> str | None:
    try:
        with httpx.Client(timeout=_METADATA_TIMEOUT) as client:
            r = client.get(f"{_METADATA}/{path}")
            if r.status_code == 200 and r.text.strip():
                return r.text.strip()
    except Exception:
        pass
    return None


def detect_public_host() -> dict[str, Any]:
    """Best-effort public hostname/IP for URLs shown to end users."""
    public_ipv4 = _ec2_metadata("public-ipv4")
    public_dns = _ec2_metadata("public-hostname")
    local_hostname = socket.gethostname()

    host = public_dns or public_ipv4 or local_hostname or "localhost"
    installer_port = int(os.getenv("INSTALLER_PORT", "9080"))
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
    }
