#!/usr/bin/env python3
"""Import workspace-realm into Keycloak if it does not exist."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

from kc_bootstrap_common import configure_realms_for_http, kc_base, master_token

ROOT = Path(__file__).resolve().parents[1]
REALM_FILE = ROOT / "keycloak" / "realm-workspace.json"


def main() -> int:
    realm_payload = json.loads(REALM_FILE.read_text(encoding="utf-8"))
    realm_name = realm_payload["realm"]
    token = master_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    with httpx.Client(timeout=60.0, verify=False) as client:
        configure_realms_for_http(client, headers, "master")

        check = client.get(f"{kc_base()}/admin/realms/{realm_name}", headers=headers)
        if check.status_code == 200:
            print(f"Realm {realm_name} already exists")
            return 0

        create = client.post(f"{kc_base()}/admin/realms", headers=headers, json=realm_payload)
        if create.status_code not in (201, 204):
            print(f"Failed to create realm: {create.status_code} {create.text}", file=sys.stderr)
            return 1

    print(f"Imported realm {realm_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
