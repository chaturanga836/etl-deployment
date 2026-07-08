"""Shared Keycloak helpers for host-side bootstrap scripts."""

from __future__ import annotations

import os
import time

import httpx


def kc_base() -> str:
    """Keycloak base URL reachable from the process running bootstrap."""
    bootstrap = os.getenv("KC_BOOTSTRAP_URL")
    if bootstrap:
        return bootstrap.rstrip("/")

    base = os.getenv("KC_SERVER_URL", "http://keycloak:8080").rstrip("/")
    port = os.getenv("KEYCLOAK_PORT", "8081")
    # KC_SERVER_URL targets the docker network; host-side scripts use localhost.
    if "keycloak" in base:
        return f"http://localhost:{port}"
    return base


def master_token() -> str:
    admin_user = os.getenv("KC_ADMIN_USER", os.getenv("KEYCLOAK_ADMIN", "admin"))
    admin_pass = os.getenv("KC_ADMIN_PASSWORD", os.getenv("KEYCLOAK_ADMIN_PASSWORD", "changeme"))
    url = f"{kc_base()}/realms/master/protocol/openid-connect/token"
    last_error = "no response"

    with httpx.Client(timeout=30.0, verify=False) as client:
        for attempt in range(30):
            try:
                resp = client.post(
                    url,
                    data={
                        "grant_type": "password",
                        "client_id": "admin-cli",
                        "username": admin_user,
                        "password": admin_pass,
                    },
                )
                if resp.status_code == 200:
                    return resp.json()["access_token"]
                last_error = f"HTTP {resp.status_code}: {resp.text[:500]}"
            except httpx.HTTPError as exc:
                last_error = str(exc)
            time.sleep(2)

    raise RuntimeError(
        f"Could not obtain Keycloak master admin token from {url} after 30 attempts: {last_error}"
    )
