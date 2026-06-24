#!/usr/bin/env python3
"""Import workspace-realm into Keycloak if it does not exist."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
REALM_FILE = ROOT / "keycloak" / "realm-workspace.json"


def _kc_base() -> str:
    return os.getenv("KC_SERVER_URL", "http://keycloak:8080").rstrip("/")


def _master_token() -> str:
    admin_user = os.getenv("KC_ADMIN_USER", os.getenv("KEYCLOAK_ADMIN", "admin"))
    admin_pass = os.getenv("KC_ADMIN_PASSWORD", os.getenv("KEYCLOAK_ADMIN_PASSWORD", "changeme"))
    url = f"{_kc_base()}/realms/master/protocol/openid-connect/token"
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
            except httpx.HTTPError:
                pass
            time.sleep(2)
    raise RuntimeError("Could not obtain Keycloak master admin token")


def main() -> int:
    realm_payload = json.loads(REALM_FILE.read_text(encoding="utf-8"))
    realm_name = realm_payload["realm"]
    token = _master_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    with httpx.Client(timeout=60.0, verify=False) as client:
        check = client.get(f"{_kc_base()}/admin/realms/{realm_name}", headers=headers)
        if check.status_code == 200:
            print(f"Realm {realm_name} already exists")
            return 0

        create = client.post(f"{_kc_base()}/admin/realms", headers=headers, json=realm_payload)
        if create.status_code not in (201, 204):
            print(f"Failed to create realm: {create.status_code} {create.text}", file=sys.stderr)
            return 1

    print(f"Imported realm {realm_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
