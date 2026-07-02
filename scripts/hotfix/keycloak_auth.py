import os
from functools import lru_cache
from typing import Annotated, Any, Dict, Iterable, Optional, Set

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt


def _realm_from_env() -> str:
    return (
        os.getenv("KC_REALM")
        or os.getenv("KC_DEV_REALM")
        or os.getenv("KC_DEV_RELM")
        or "workspace-realm"
    )


def _realm_issuer(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/realms/{_realm_from_env()}"


def _server_url_from_env() -> str:
    return os.getenv("KC_SERVER_URL", "http://localhost:8081").rstrip("/")


def _public_server_url_from_env() -> str:
    """Browser-facing Keycloak base URL (HTTPS reverse proxy), when different from KC_SERVER_URL."""
    configured = os.getenv("KC_PUBLIC_URL") or os.getenv("KC_PUBLIC_ISSUER")
    if configured:
        value = configured.rstrip("/")
        marker = "/realms/"
        if marker in value:
            return value.split(marker, 1)[0]
        return value
    return _server_url_from_env()


def _allowed_issuers() -> list[str]:
    """JWT iss values to accept — public proxy URL and internal URL may both appear."""
    issuers: list[str] = []
    seen: set[str] = set()

    def add(candidate: str | None) -> None:
        if not candidate:
            return
        for part in candidate.split(","):
            normalized = part.strip().rstrip("/")
            if normalized and normalized not in seen:
                seen.add(normalized)
                issuers.append(normalized)

    add(os.getenv("KC_ISSUER"))
    add(_realm_issuer(_public_server_url_from_env()))
    token_url = os.getenv("KEYCLOAK_TOKEN_URL", "")
    if token_url.endswith("/protocol/openid-connect/token"):
        add(token_url[: -len("/protocol/openid-connect/token")])
    add(_realm_issuer(_server_url_from_env()))
    return issuers


def _issuer_from_env() -> str:
    """Primary issuer for JWT validation (first configured allowed issuer)."""
    allowed = _allowed_issuers()
    if allowed:
        return allowed[0]
    return _realm_issuer(_server_url_from_env())


def _web_client_id_from_env() -> str:
    return os.getenv("KC_WEB_CLIENT_ID") or os.getenv("KC_CLIENT_ID") or "workspace-web"


def _token_url() -> str:
    configured = os.getenv("KEYCLOAK_TOKEN_URL")
    if configured:
        return configured
    return f"{_server_url_from_env()}/realms/{_realm_from_env()}/protocol/openid-connect/token"


oauth2_scheme = OAuth2PasswordBearer(tokenUrl=_token_url())


def _jwks_urls() -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(url: str | None) -> None:
        if not url or url in seen:
            return
        seen.add(url)
        urls.append(url)

    add(os.getenv("KC_JWKS_URL"))
    add(f"{_public_server_url_from_env()}/realms/{_realm_from_env()}/protocol/openid-connect/certs")
    add(f"{_server_url_from_env()}/realms/{_realm_from_env()}/protocol/openid-connect/certs")
    return urls


@lru_cache(maxsize=1)
def _jwks() -> Dict[str, Any]:
    last_error: Exception | None = None
    for url in _jwks_urls():
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.get(url)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("No Keycloak JWKS URL configured")


def _token_matches_client(payload: Dict[str, Any], client_id: str) -> bool:
    """Public Keycloak clients often use aud=account; azp holds the client id."""
    azp = payload.get("azp")
    if azp == client_id:
        return True
    aud = payload.get("aud")
    if aud is None:
        return False
    if isinstance(aud, str):
        return aud == client_id
    if isinstance(aud, list):
        return client_id in aud
    return False


def _workspace_paths_for(workspace_id: int) -> Set[str]:
    return {
        f"/workspaces/ws-{workspace_id}",
        f"/workspaces/{workspace_id}",
    }


def _has_group_for_workspace(groups: Iterable[str], workspace_id: int) -> bool:
    roots = _workspace_paths_for(workspace_id)
    for group in groups:
        for root in roots:
            if group.startswith(root):
                return True
    return False


def _has_workspace_role(groups: Iterable[str], workspace_id: int, roles: Set[str]) -> bool:
    suffix_map = {
        "workspace_admin": "/admins",
        "workspace_editor": "/editors",
        "workspace_viewer": "/viewers",
        "workspace_user": "/members",
    }
    roots = _workspace_paths_for(workspace_id)
    wanted_suffixes = {suffix_map[r] for r in roles if r in suffix_map}

    for group in groups:
        for root in roots:
            if group == root and "workspace_user" in roles:
                return True
            for suffix in wanted_suffixes:
                if group.startswith(f"{root}{suffix}"):
                    return True
    return False


def _userinfo_url() -> str:
    return f"{_public_server_url_from_env()}/realms/{_realm_from_env()}/protocol/openid-connect/userinfo"


def _identity_from_claims(claims: Dict[str, Any]) -> str | None:
    for key in ("sub", "email", "preferred_username", "username"):
        value = claims.get(key)
        if value:
            return str(value)
    return None


def _fetch_userinfo(token: str) -> Dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            _userinfo_url(),
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
        return response.json()


def resolve_user_identity(user: Dict[str, Any]) -> str | None:
    """Best-effort stable user key from JWT claims, with Keycloak userinfo fallback."""
    identity = _identity_from_claims(user)
    if identity:
        return identity
    raw_token = user.get("raw_token")
    if not raw_token:
        return None
    try:
        return _identity_from_claims(_fetch_userinfo(raw_token))
    except Exception:
        return None


def _verified_payload(token: str) -> Dict[str, Any]:
    client_id = _web_client_id_from_env()
    algorithms = [os.getenv("ALGORITHM", "RS256")]
    decode_options = {"verify_aud": False, "verify_at_hash": False}

    last_error: Optional[JWTError] = None
    keys = _jwks().get("keys", [])
    for issuer in _allowed_issuers():
        for key in keys:
            try:
                payload = jwt.decode(
                    token,
                    key,
                    algorithms=algorithms,
                    issuer=issuer,
                    options=decode_options,
                )
                if not _token_matches_client(payload, client_id):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Token not issued for this application",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
                return payload
            except JWTError as exc:
                last_error = exc
                continue

    detail = "Invalid token signature or claims"
    if last_error and os.getenv("DEBUG", "").lower() in ("1", "true", "yes"):
        detail = f"{detail}: {last_error} (allowed issuers: {', '.join(_allowed_issuers())})"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> Dict[str, Any]:
    payload = _verified_payload(token)
    realm_roles = set(payload.get("realm_access", {}).get("roles", []))

    sub = payload.get("sub")
    email = payload.get("email")
    preferred_username = payload.get("preferred_username")
    if not sub and not email and not preferred_username:
        try:
            info = _fetch_userinfo(token)
            sub = sub or info.get("sub")
            email = email or info.get("email")
            preferred_username = preferred_username or info.get("preferred_username")
        except Exception:
            pass

    return {
        "sub": sub,
        "email": email,
        "preferred_username": preferred_username,
        "realm_roles": realm_roles,
        "workspace_groups": payload.get("workspace_groups", payload.get("groups", [])),
        "raw_token": token,
    }


def require_super_admin(
    user: Annotated[Dict[str, Any], Depends(get_current_user)],
) -> Dict[str, Any]:
    if "super_admin" not in user["realm_roles"]:
        raise HTTPException(status_code=403, detail="Super admin role required")
    return user


def require_workspace_access(
    allowed_roles: Optional[Set[str]] = None,
    allow_super_admin: bool = True,
):
    from core.workspace_auth import assert_workspace_access

    role_set = allowed_roles or {"workspace_user"}

    def dependency(
        workspace_id: int,
        user: Annotated[Dict[str, Any], Depends(get_current_user)],
    ) -> Dict[str, Any]:
        assert_workspace_access(
            user,
            workspace_id,
            allowed_roles=role_set,
            allow_super_admin=allow_super_admin,
        )
        return user

    return dependency
