#!/usr/bin/env python3
"""Create platform superadmin user in Keycloak workspace-realm."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

from kc_bootstrap_common import kc_base, master_token


def _realm() -> str:
    return (
        os.getenv("KC_REALM")
        or os.getenv("KC_DEV_REALM")
        or "workspace-realm"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    realm = _realm()
    token = master_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = f"{kc_base()}/admin/realms/{realm}"

    with httpx.Client(timeout=60.0, verify=False) as client:
        lookup = client.get(
            f"{base}/users",
            headers=headers,
            params={"username": args.username, "exact": "true"},
        )
        if lookup.status_code >= 400:
            print(lookup.text, file=sys.stderr)
            return 1

        users = lookup.json()
        if users:
            user_id = users[0]["id"]
            print(f"User {args.username} already exists")
        else:
            create = client.post(
                f"{base}/users",
                headers=headers,
                json={
                    "username": args.username,
                    "email": args.email,
                    "enabled": True,
                    "emailVerified": True,
                },
            )
            if create.status_code not in (201, 204):
                print(f"Create user failed: {create.status_code} {create.text}", file=sys.stderr)
                return 1
            lookup2 = client.get(
                f"{base}/users",
                headers=headers,
                params={"username": args.username, "exact": "true"},
            )
            user_id = lookup2.json()[0]["id"]

        client.put(
            f"{base}/users/{user_id}/reset-password",
            headers=headers,
            json={"type": "password", "value": args.password, "temporary": False},
        )

        roles_resp = client.get(f"{base}/roles", headers=headers)
        roles = {r["name"]: r for r in roles_resp.json()}
        super_role = roles.get("super_admin")
        if not super_role:
            client.post(
                f"{base}/roles",
                headers=headers,
                json={"name": "super_admin", "description": "Platform super administrator"},
            )
            roles_resp = client.get(f"{base}/roles", headers=headers)
            super_role = next(r for r in roles_resp.json() if r["name"] == "super_admin")

        client.post(
            f"{base}/users/{user_id}/role-mappings/realm",
            headers=headers,
            json=[{"id": super_role["id"], "name": super_role["name"]}],
        )

    state_dir = os.getenv("INSTALLER_STATE_DIR", "/opt/etl-deployment-state")
    out = Path(state_dir) / "superadmin.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"user_id": user_id, "username": args.username, "email": args.email}),
        encoding="utf-8",
    )

    print(f"Superadmin {args.username} ready in realm {realm}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
