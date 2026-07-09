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


def wait_for_keycloak(*, attempts: int = 90, sleep_seconds: float = 2.0) -> None:
    """Block until Keycloak accepts HTTP on the bootstrap URL."""
    base = kc_base()
    probe_url = f"{base}/realms/master"
    last_error = "no response"

    with httpx.Client(timeout=10.0, verify=False) as client:
        for _ in range(attempts):
            try:
                resp = client.get(probe_url)
                if resp.status_code == 200:
                    return
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            except httpx.HTTPError as exc:
                last_error = str(exc)
            time.sleep(sleep_seconds)

    raise RuntimeError(
        f"Keycloak not ready at {probe_url} after {attempts} attempts: {last_error}"
    )


def master_token() -> str:
    wait_for_keycloak()
    admin_user = os.getenv("KC_ADMIN_USER", os.getenv("KEYCLOAK_ADMIN", "admin"))
    admin_pass = os.getenv("KC_ADMIN_PASSWORD", os.getenv("KEYCLOAK_ADMIN_PASSWORD", "changeme"))
    url = f"{kc_base()}/realms/master/protocol/openid-connect/token"
    last_error = "no response"

    with httpx.Client(timeout=30.0, verify=False) as client:
        for attempt in range(60):
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
        f"Could not obtain Keycloak master admin token from {url} after 60 attempts: {last_error}"
    )
