"""Workspace-scoped DB sessions via PostgreSQL search_path."""

from __future__ import annotations

from typing import Annotated, Any, Dict, Generator, Optional, Set, cast

from fastapi import Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db
from core.keycloak_auth import get_current_user
from core.workspace_auth import WORKSPACE_READ_ROLES, WORKSPACE_WRITE_ROLES, assert_workspace_access
from core.workspace_schema import workspace_schema_name
from models.workspace import Workspace


def set_workspace_search_path(db: Session, workspace_id: int) -> str:
    schema = workspace_schema_name(workspace_id)
    db.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
    return schema


def get_workspace_registry(db: Session, workspace_id: int) -> Workspace:
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def ensure_workspace_schema_storage(db: Session, workspace_id: int) -> Workspace:
    """Ensure ws_{id} exists; auto-provision legacy workspaces on first use."""
    workspace = get_workspace_registry(db, workspace_id)
    expected_schema = workspace_schema_name(workspace_id)
    if (
        cast(str | None, workspace.metadata_storage) == "schema"
        and cast(str | None, workspace.metadata_schema) == expected_schema
    ):
        return workspace

    from services.workspace_schema_service import provision_workspace_metadata_schema

    provision_workspace_metadata_schema(db, workspace)
    db.flush()
    return workspace


def require_workspace_schema_storage(db: Session, workspace_id: int) -> Workspace:
    return ensure_workspace_schema_storage(db, workspace_id)


def activate_workspace_session(
    db: Session,
    workspace_id: int,
    *,
    user: Optional[Dict[str, Any]] = None,
    write: bool = False,
) -> str:
    if user is not None:
        roles: Set[str] = set(WORKSPACE_WRITE_ROLES if write else WORKSPACE_READ_ROLES)
        assert_workspace_access(user, workspace_id, allowed_roles=roles)
    require_workspace_schema_storage(db, workspace_id)
    return set_workspace_search_path(db, workspace_id)


def get_workspace_db(
    workspace_id: Annotated[int, Query(..., ge=1, description="Workspace that owns this resource")],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Dict[str, Any], Depends(get_current_user)],
) -> Generator[Session, None, None]:
    activate_workspace_session(db, workspace_id, user=user, write=False)
    yield db


def get_workspace_db_write(
    workspace_id: Annotated[int, Query(..., ge=1, description="Workspace that owns this resource")],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Dict[str, Any], Depends(get_current_user)],
) -> Generator[Session, None, None]:
    activate_workspace_session(db, workspace_id, user=user, write=True)
    yield db
