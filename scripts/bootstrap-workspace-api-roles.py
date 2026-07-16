#!/usr/bin/env python3
"""Grant workspace-api service account Keycloak Admin API roles for group/user management."""

from __future__ import annotations

import os
import sys

import httpx

from kc_bootstrap_common import kc_base, master_token

# Minimum roles for etl-back workspace_access_service (groups, users, invitations).
WORKSPACE_API_CLIENT_ROLES = (
    "view-groups",
    "manage-groups",
    "query-groups",
    "view-users",
    "manage-users",
    "query-users",
    "impersonation",
)


def _realm() -> str:
    return (
        os.getenv("KC_REALM")
        or os.getenv("KC_DEV_REALM")
        or os.getenv("KC_DEV_RELM")
        or "workspace-realm"
    )


def _admin_client_id() -> str:
    return (
        os.getenv("KC_API_CLIENT_ID")
        or os.getenv("KC_ADMIN_CLIENT_ID")
        or "workspace-api"
    )


def _client_uuid(client: httpx.Client, base: str, headers: dict[str, str], client_id: str) -> str:
    response = client.get(
        f"{base}/clients",
        headers=headers,
        params={"clientId": client_id},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Failed to list clients ({client_id}): {response.text}")
    matches = response.json()
    if not matches:
        raise RuntimeError(f"Client not found in realm: {client_id}")
    return matches[0]["id"]


def _service_account_user_id(
    client: httpx.Client, base: str, headers: dict[str, str], api_client_uuid: str
) -> str:
    response = client.get(
        f"{base}/clients/{api_client_uuid}/service-account-user",
        headers=headers,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"workspace-api has no service account: {response.text}")
    return response.json()["id"]


def _assign_missing_roles(
    client: httpx.Client,
    base: str,
    headers: dict[str, str],
    *,
    user_id: str,
    mgmt_client_uuid: str,
    role_names: tuple[str, ...],
) -> list[str]:
    assigned: list[str] = []
    existing_resp = client.get(
        f"{base}/users/{user_id}/role-mappings/clients/{mgmt_client_uuid}",
        headers=headers,
    )
    if existing_resp.status_code >= 400:
        raise RuntimeError(f"Failed to read service account roles: {existing_resp.text}")
    existing = {role["name"] for role in existing_resp.json()}

    to_assign = []
    for role_name in role_names:
        if role_name in existing:
            continue
        role_resp = client.get(
            f"{base}/clients/{mgmt_client_uuid}/roles/{role_name}",
            headers=headers,
        )
        if role_resp.status_code >= 400:
            raise RuntimeError(f"realm-management role missing: {role_name}")
        to_assign.append(role_resp.json())

    if not to_assign:
        return assigned

    assign_resp = client.post(
        f"{base}/users/{user_id}/role-mappings/clients/{mgmt_client_uuid}",
        headers=headers,
        json=to_assign,
    )
    if assign_resp.status_code >= 400:
        raise RuntimeError(f"Failed assigning service account roles: {assign_resp.text}")
    assigned.extend(role["name"] for role in to_assign)
    return assigned


def main() -> int:
    realm = _realm()
    api_client_id = _admin_client_id()
    token = master_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = f"{kc_base()}/admin/realms/{realm}"

    with httpx.Client(timeout=60.0, verify=False) as client:
        api_uuid = _client_uuid(client, base, headers, api_client_id)
        mgmt_uuid = _client_uuid(client, base, headers, "realm-management")
        service_user_id = _service_account_user_id(client, base, headers, api_uuid)
        assigned = _assign_missing_roles(
            client,
            base,
            headers,
            user_id=service_user_id,
            mgmt_client_uuid=mgmt_uuid,
            role_names=WORKSPACE_API_CLIENT_ROLES,
        )

    if assigned:
        print(f"Assigned realm-management roles to {api_client_id}: {', '.join(assigned)}")
    else:
        print(f"Service account for {api_client_id} already has required roles")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
