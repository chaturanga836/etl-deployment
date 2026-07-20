"""Shared Keycloak helpers for host-side bootstrap scripts."""

from __future__ import annotations

import os
import time

import httpx


def _running_inside_installer() -> bool:
    """Wizard container: localhost is not the host where Keycloak publishes its port."""
    return os.path.isfile("/.dockerenv") and os.path.exists("/var/run/docker.sock")


def _keycloak_reachable(probe_url: str) -> tuple[bool, str]:
    """Return (ok, last_error). Uses host-network wget from installer when possible."""
    port = os.getenv("KEYCLOAK_PORT", "8081")
    last_error = "no response"
    if _running_inside_installer():
        import subprocess

        try:
            subprocess.run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "host",
                    "alpine:3.20",
                    "wget",
                    "-q",
                    "-O",
                    "/dev/null",
                    f"http://127.0.0.1:{port}/realms/master",
                ],
                check=True,
                capture_output=True,
                timeout=15,
            )
            return True, ""
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            last_error = str(exc)

    try:
        with httpx.Client(timeout=10.0, verify=False) as client:
            resp = client.get(probe_url)
            if resp.status_code == 200:
                return True, ""
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
    except httpx.HTTPError as exc:
        last_error = str(exc)
    return False, last_error


def kc_base() -> str:
    """Keycloak base URL reachable from the process running bootstrap."""
    port = os.getenv("KEYCLOAK_PORT", "8081")
    if _running_inside_installer():
        host = os.getenv("KC_INSTALLER_HOST", "host.docker.internal")
        return f"http://{host}:{port}"

    bootstrap = os.getenv("KC_BOOTSTRAP_URL")
    if bootstrap:
        return bootstrap.rstrip("/")

    base = os.getenv("KC_SERVER_URL", "http://keycloak:8080").rstrip("/")
    # KC_SERVER_URL targets the docker network; host-side scripts use localhost.
    if "keycloak" in base:
        return f"http://localhost:{port}"
    return base


def wait_for_keycloak(*, attempts: int = 180, sleep_seconds: float = 2.0) -> None:
    """Block until Keycloak accepts HTTP on the bootstrap URL."""
    base = kc_base()
    probe_url = f"{base}/realms/master"
    last_error = "no response"

    for _ in range(attempts):
        ok, last_error = _keycloak_reachable(probe_url)
        if ok:
            return
        time.sleep(sleep_seconds)

    raise RuntimeError(
        f"Keycloak not ready at {probe_url} after {attempts} attempts: {last_error}"
    )


def configure_realms_for_http(client: httpx.Client, headers: dict[str, str], *realm_names: str) -> None:
    """Allow plain HTTP for self-host installs (Keycloak requires HTTPS on public IPs by default)."""
    for realm_name in realm_names:
        resp = client.get(f"{kc_base()}/admin/realms/{realm_name}", headers=headers)
        if resp.status_code != 200:
            continue
        realm = resp.json()
        if realm.get("sslRequired") == "none":
            continue
        realm["sslRequired"] = "none"
        client.put(f"{kc_base()}/admin/realms/{realm_name}", headers=headers, json=realm)


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
