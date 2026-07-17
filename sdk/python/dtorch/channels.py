"""Centrifugo channel-name helpers."""

from __future__ import annotations


def channel_for_user(org_id: int, keycloak_sub: str) -> str:
    return f"org:{org_id}:user:{keycloak_sub}"


def channel_for_workspace(org_id: int, workspace_id: int) -> str:
    return f"org:{org_id}:ws:{workspace_id}"


def channel_named(org_id: int, workspace_id: int, name: str) -> str:
    return f"org:{org_id}:ws:{workspace_id}:channel:{name}"
