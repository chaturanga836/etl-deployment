#!/usr/bin/env python3
"""Render .env and deployment metadata from a deployment config JSON file."""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus


def _env_line(key: str, value: Any) -> str:
    """Format a shell-safe .env line (install.sh sources this file)."""
    text = "" if value is None else str(value)
    if text and not any(c.isspace() or c in "#$`!&|;()<>" for c in text):
        return f"{key}={text}"
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
    return f'{key}="{escaped}"'


def _public_base_url(host: str, port: int, use_proxy: bool) -> str:
    if use_proxy and port == 80:
        return f"http://{host}"
    if use_proxy and port == 443:
        return f"https://{host}"
    return f"http://{host}:{port}"


def _database_url(config: dict[str, Any]) -> tuple[str, str, str, str, str]:
    db = config["database"]
    user = db["user"]
    # Bundled installs may omit password; compose defaults POSTGRES_PASSWORD to changeme.
    raw_password = (db.get("password") or "").strip()
    if not raw_password and db.get("source") == "bundled":
        raw_password = "changeme"
    password = quote_plus(raw_password)
    # Legacy JSON key elt_db_name → metadata_db_name
    metadata_db = db.get("metadata_db_name") or db.get("elt_db_name", "dtorc_metadata")
    workspace_db = db.get("workspace_db_name", "dtorc_workspace")

    if db["source"] == "bundled":
        host = (db.get("host") or "").strip() or "postgres"
        port = int(db.get("port") or 5432)
    else:
        host = db["host"]
        port = int(db.get("port", 5432))

    base = f"postgresql://{user}:{password}@{host}:{port}"
    return (
        f"{base}/{metadata_db}",
        f"{base}/{workspace_db}",
        user,
        raw_password,
        metadata_db,
    )


def _workspace_sql_url(config: dict[str, Any], fallback_pg_workspace_url: str) -> tuple[str, str]:
    """Return (WORKSPACE_SQL_ENGINE, WORKSPACE_DATABASE_URL)."""
    ws = config.get("workspace_sql") or {}
    engine = (ws.get("engine") or "postgres").strip().lower()
    if engine not in {"postgres", "mysql"}:
        engine = "postgres"
    if engine == "postgres":
        # Prefer explicit workspace_sql host when external; else platform workspace URL.
        if (ws.get("source") or "bundled") == "external" and (ws.get("host") or "").strip():
            user = ws.get("user") or "elt"
            raw_password = (ws.get("password") or "").strip() or "changeme"
            host = ws["host"].strip()
            port = int(ws.get("port") or 5432)
            db_name = ws.get("database_name") or "dtorc_workspace"
            url = (
                f"postgresql://{quote_plus(user)}:{quote_plus(raw_password)}"
                f"@{host}:{port}/{db_name}"
            )
            return engine, url
        return engine, fallback_pg_workspace_url

    user = ws.get("user") or "elt"
    raw_password = (ws.get("password") or "").strip() or "changeme"
    host = (ws.get("host") or "").strip() or "mysql"
    port = int(ws.get("port") or 3306)
    db_name = ws.get("database_name") or "dtorc_workspace"
    url = (
        f"mysql+pymysql://{quote_plus(user)}:{quote_plus(raw_password)}"
        f"@{host}:{port}/{db_name}"
    )
    return engine, url


def _mongo_url(config: dict[str, Any]) -> str:
    mongo = config.get("mongo") or {}
    source = (mongo.get("source") or "skip").strip().lower()
    if source == "skip":
        return ""
    user = mongo.get("user") or "elt"
    raw_password = (mongo.get("password") or "").strip() or "changeme"
    host = (mongo.get("host") or "").strip() or "mongo"
    port = int(mongo.get("port") or 27017)
    db_name = mongo.get("database_name") or "dtorc_mongo"
    return (
        f"mongodb://{quote_plus(user)}:{quote_plus(raw_password)}"
        f"@{host}:{port}/{db_name}?authSource=admin"
    )


def _extra_compose_profiles(config: dict[str, Any]) -> str:
    profiles: list[str] = []
    ws = config.get("workspace_sql") or {}
    if (ws.get("engine") or "postgres").strip().lower() == "mysql" and (
        ws.get("source") or "bundled"
    ) == "bundled":
        profiles.append("workspace-mysql")
    mongo = config.get("mongo") or {}
    if (mongo.get("source") or "skip").strip().lower() == "bundled":
        profiles.append("workspace-mongo")
    return ",".join(profiles)


def _registry_lines(config: dict[str, Any]) -> list[str]:
    reg = config.get("registry", {})
    app = config.get("app", {})
    url = reg.get("url", "ghcr.io/YOUR_GITHUB_ORG")
    tag = reg.get("image_tag") or app.get("image_tag", "v1.0.0")
    return [
        f"REGISTRY_URL={url}",
        f"IMAGE_TAG={tag}",
        f"API_IMAGE={url}/dt-orch-api:{tag}",
        f"FRONTEND_IMAGE={url}/dt-orch-frontend:{tag}",
        f"INFRA_IMAGE={url}/baas-infra:{tag}",
        f"SCRAPER_IMAGE={url}/dt-orch-scraper:{tag}",
        "",
    ]


def _redis_url(config: dict[str, Any]) -> str:
    redis_cfg = config.get("redis") or {}
    if redis_cfg:
        host = (redis_cfg.get("host") or "").strip() or "redis"
        port = int(redis_cfg.get("port") or 6379)
        password = (redis_cfg.get("password") or "").strip()
        if password:
            return f"redis://:{quote_plus(password)}@{host}:{port}/0"
        return f"redis://{host}:{port}/0"

    if config["mode"] != "distributed":
        return "redis://redis:6379/0"
    dist_redis = config.get("distributed", {}).get("services", {}).get("redis", {})
    host = dist_redis.get("host", "redis")
    port = dist_redis.get("port", 6379)
    return f"redis://{host}:{port}/0"


def _centrifugo_env_lines(config: dict[str, Any]) -> list[str]:
    cf = config.get("centrifugo") or {}
    if not cf:
        return []
    source = (cf.get("source") or "bundled").strip()
    if source == "bundled":
        host = "centrifugo"
        port = 8000
    else:
        host = (cf.get("host") or "").strip() or "localhost"
        port = int(cf.get("http_port") or 8001)
    api_url = f"http://{host}:{port}"
    ws_url = f"ws://{host}:{port}/connection/websocket"
    lines = [
        f"CENTRIFUGO_DEFAULT_API_URL={api_url}",
        f"CENTRIFUGO_DEFAULT_WS_URL={ws_url}",
        f"CENTRIFUGO_SOURCE={source}",
    ]
    if cf.get("api_key"):
        lines.append(_env_line("CENTRIFUGO_DEFAULT_API_KEY", cf["api_key"]))
    if cf.get("token_hmac_secret_key"):
        lines.append(_env_line("CENTRIFUGO_DEFAULT_TOKEN_HMAC_SECRET_KEY", cf["token_hmac_secret_key"]))
    lines.append("")
    return lines


def _minio_env_lines(config: dict[str, Any]) -> list[str]:
    minio = config.get("minio") or {}
    if not minio:
        return []
    source = (minio.get("source") or "bundled").strip()
    if source == "bundled":
        host = "platform-shared-minio-storage"
        port = 9000
    else:
        host = (minio.get("host") or "").strip() or "platform-shared-minio-storage"
        port = int(minio.get("port") or 9000)
    endpoint = f"http://{host}:{port}"
    return [
        f"SHARED_MINIO_ENDPOINT={endpoint}",
        _env_line("SHARED_MINIO_ACCESS_KEY", minio.get("access_key", "")),
        _env_line("SHARED_MINIO_SECRET_KEY", minio.get("secret_key", "")),
        f"SHARED_STORAGE_BUCKET={minio.get('bucket') or 'data'}",
        f"MINIO_SOURCE={source}",
        "",
    ]


def _platform_infra_url(config: dict[str, Any]) -> str:
    if config["mode"] != "distributed":
        return "http://infra-service:9000"
    infra = config.get("distributed", {}).get("services", {}).get("infra", {})
    host = infra.get("host", "localhost")
    port = infra.get("port", 9000)
    return f"http://{host}:{port}"


def render_env(config: dict[str, Any]) -> str:
    mode = config["mode"]
    db = config["database"]
    kc = config["keycloak"]
    app = config.get("app", {})
    database_url, workspace_database_url, pg_user, pg_password, metadata_db = _database_url(config)
    ws_engine, workspace_database_url = _workspace_sql_url(config, workspace_database_url)
    mongo_url = _mongo_url(config)
    extra_profiles = _extra_compose_profiles(config)
    realm = kc["realm"]

    lines: list[str] = [
        "# Generated by etl-deployment/renderer/render.py",
        f"# mode={mode}",
        "",
    ]
    lines.extend(_registry_lines(config))

    if mode == "monolith":
        mono = config["monolith"]
        host = mono.get("public_host", "localhost")
        use_proxy = mono.get("use_proxy", True)
        ports = mono.get("ports", {})
        http_port = ports.get("http", 80)
        api_port = ports.get("api", 8000)
        frontend_port = ports.get("frontend", 3001)
        keycloak_port = ports.get("keycloak", 8081)

        app_url = _public_base_url(host, http_port, use_proxy)
        # Browser reaches Keycloak via nginx on APP_URL (/realms/), not :8081 on public hosts.
        kc_public = app_url if use_proxy else f"http://{host}:{keycloak_port}"
        if use_proxy:
            next_public_api = f"{app_url}/api/v1"
        else:
            next_public_api = f"http://{host}:{api_port}/api/v1"

        lines.extend([
            f"APP_URL={app_url}",
            f"HTTP_PORT={http_port}",
            f"API_PORT={api_port}",
            f"FRONTEND_PORT={frontend_port}",
            # Host publish ports (container internals stay 9000). MinIO owns :9000; infra uses :9100.
            "MINIO_PORT=9000",
            "MINIO_CONSOLE_PORT=9001",
            "INFRA_SERVICE_PORT=9100",
            "CENTRIFUGO_PORT=8001",
            f"NEXT_PUBLIC_API_URL={next_public_api}",
            f"NEXT_PUBLIC_KC_URL={kc_public}",
            f"NEXT_PUBLIC_KC_REALM={realm}",
            "NEXT_PUBLIC_KC_CLIENT_ID=workspace-web",
            f"FRONTEND_URL={app_url}",
            "",
        ])
    elif mode == "kubernetes":
        k8s = config.get("kubernetes", {})
        host = k8s.get("ingress_host", "localhost")
        app_url = f"https://{host}"
        lines.extend([
            f"APP_URL={app_url}",
            f"NEXT_PUBLIC_API_URL={app_url}/api/v1",
            f"NEXT_PUBLIC_KC_URL={app_url}",
            f"NEXT_PUBLIC_KC_REALM={realm}",
            "NEXT_PUBLIC_KC_CLIENT_ID=workspace-web",
            f"FRONTEND_URL={app_url}",
            "",
        ])
    else:
        dist = config["distributed"]
        services = dist.get("services", {})
        frontend = services.get("frontend", {})
        backend = services.get("backend", {})
        auth = services.get("auth", {})
        fe_host = frontend.get("host", "localhost")
        fe_port = frontend.get("port", 443)
        be_host = backend.get("host", "localhost")
        auth_host = auth.get("host", "localhost")
        auth_port = auth.get("port", 8081)
        be_port = backend.get("port", 8000)
        app_url = f"https://{fe_host}" if fe_port == 443 else f"http://{fe_host}:{fe_port}"
        lines.extend([
            f"APP_URL={app_url}",
            f"NEXT_PUBLIC_API_URL=http://{be_host}:{be_port}/api/v1",
            f"NEXT_PUBLIC_KC_URL=http://{auth_host}:{auth_port}",
            f"NEXT_PUBLIC_KC_REALM={realm}",
            "NEXT_PUBLIC_KC_CLIENT_ID=workspace-web",
            f"KC_SERVER_URL=http://{auth_host}:{auth_port}",
            f"KEYCLOAK_TOKEN_URL=http://{auth_host}:{auth_port}/realms/{realm}/protocol/openid-connect/token",
            f"PLATFORM_INFRA_URL={_platform_infra_url(config)}",
            f"FRONTEND_URL={app_url}",
            "",
        ])

    lines.extend([
        "NEXT_PUBLIC_BUILD_ID=production",
        "",
        f"POSTGRES_USER={pg_user}",
        _env_line("POSTGRES_PASSWORD", pg_password),
        "POSTGRES_DB=postgres",
        f"DTORC_METADATA_DB_NAME={metadata_db}",
        f"DTORC_WORKSPACE_DB_NAME={db.get('workspace_db_name', 'dtorc_workspace')}",
        f"KEYCLOAK_DB_NAME={db.get('keycloak_db_name', 'keycloak')}",
        "",
        f"DATABASE_URL={database_url}",
        f"WORKSPACE_SQL_ENGINE={ws_engine}",
        f"WORKSPACE_DATABASE_URL={workspace_database_url}",
        _env_line("WORKSPACE_MONGO_URL", mongo_url),
        f"EXTRA_COMPOSE_PROFILES={extra_profiles}",
        f"REDIS_URL={_redis_url(config)}",
        f"SANDBOX_ENABLED={'true' if app.get('sandbox_enabled', True) else 'false'}",
        "",
        _env_line("APP_NAME", app.get("name", "DT Orch")),
        "DEBUG=false",
        "",
    ])

    ws = config.get("workspace_sql") or {}
    if ws_engine == "mysql":
        lines.extend([
            f"MYSQL_USER={ws.get('user') or pg_user}",
            _env_line("MYSQL_PASSWORD", ws.get("password") or pg_password),
            f"MYSQL_DATABASE={ws.get('database_name') or 'dtorc_workspace'}",
            _env_line("MYSQL_ROOT_PASSWORD", ws.get("password") or pg_password),
            "",
        ])
    mongo = config.get("mongo") or {}
    if (mongo.get("source") or "skip") != "skip":
        lines.extend([
            f"MONGO_USER={mongo.get('user') or 'elt'}",
            _env_line("MONGO_PASSWORD", mongo.get("password") or pg_password),
            f"MONGO_DATABASE={mongo.get('database_name') or 'dtorc_mongo'}",
            "",
        ])

    if mode == "monolith":
        keycloak_port = int(
            kc.get("port")
            or config["monolith"].get("ports", {}).get("keycloak", 8081)
        )
        host = config["monolith"].get("public_host", "localhost")
        use_proxy = config["monolith"].get("use_proxy", True)
        http_port = config["monolith"].get("ports", {}).get("http", 80)
        app_url = _public_base_url(host, http_port, use_proxy)
        kc_public = app_url if use_proxy else f"http://{host}:{keycloak_port}"
        kc_source = kc.get("source", "bundled")
        if kc_source == "external":
            kc_internal_host = (kc.get("host") or "").strip() or host
            kc_server_url = f"http://{kc_internal_host}:{keycloak_port}"
            kc_token_url = f"{kc_server_url}/realms/{realm}/protocol/openid-connect/token"
            kc_bootstrap = kc_server_url
        else:
            kc_server_url = "http://keycloak:8080"
            kc_token_url = f"http://keycloak:8080/realms/{realm}/protocol/openid-connect/token"
            kc_bootstrap = f"http://localhost:{keycloak_port}"
        lines.extend([
            f"KEYCLOAK_PORT={keycloak_port}",
            f"KC_ADMIN_USER={kc['admin_user']}",
            _env_line("KC_ADMIN_PASSWORD", kc["admin_password"]),
            f"KC_BOOTSTRAP_URL={kc_bootstrap}",
            f"KC_SERVER_URL={kc_server_url}",
            f"KC_PUBLIC_URL={kc_public}",
            f"KC_ISSUER={kc_public}/realms/{realm}",
            f"KC_JWKS_URL={kc_public}/realms/{realm}/protocol/openid-connect/certs",
            f"KC_DEV_REALM={realm}",
            f"KC_REALM={realm}",
            f"KEYCLOAK_TOKEN_URL={kc_token_url}",
            f"KC_ADMIN_CLIENT_ID={kc.get('admin_client_id', 'workspace-api')}",
            f"KC_ADMIN_CLIENT_SECRET={kc.get('admin_client_secret', 'changeme-api-secret')}",
            f"KC_API_CLIENT_ID={kc.get('admin_client_id', 'workspace-api')}",
            f"KC_API_CLIENT_SECRET={kc.get('admin_client_secret', 'changeme-api-secret')}",
            f"PLATFORM_INFRA_URL={_platform_infra_url(config)}",
            "",
            f"# Public Keycloak URL (browser): {kc_public}",
        ])
    else:
        lines.extend([
            f"KC_ADMIN_USER={kc['admin_user']}",
            _env_line("KC_ADMIN_PASSWORD", kc["admin_password"]),
            f"KC_DEV_REALM={realm}",
            f"KC_REALM={realm}",
            f"KC_ADMIN_CLIENT_ID={kc.get('admin_client_id', 'workspace-api')}",
            f"KC_ADMIN_CLIENT_SECRET={kc.get('admin_client_secret', 'changeme-api-secret')}",
            f"KC_API_CLIENT_ID={kc.get('admin_client_id', 'workspace-api')}",
            f"KC_API_CLIENT_SECRET={kc.get('admin_client_secret', 'changeme-api-secret')}",
        ])

    lines.extend(_minio_env_lines(config))
    lines.extend(_centrifugo_env_lines(config))

    deploy_env = config.get("deploy_env", "development")
    bootstrap_token = secrets.token_hex(32)
    superadmin = config.get("superadmin", {})
    super_email = superadmin.get("email") or f"{superadmin.get('username', 'admin')}@users.local"

    lines.extend([
        _env_line("DTORCH_ENV", deploy_env),
        "LICENSE_PUBLIC_KEY_PATH=/etc/dt-orch/license-public.pem",
        "DTORCH_SETUP_COMPLETE=false",
        f"INSTALL_BOOTSTRAP_TOKEN={bootstrap_token}",
        _env_line("SUPERADMIN_USERNAME", superadmin.get("username", "")),
        _env_line("SUPERADMIN_EMAIL", super_email),
        "",
        "# LICENSE_KEY omitted — no license or trial gate.",
    ])

    return "\n".join(lines) + "\n"


def _role_manifest(config: dict[str, Any]) -> list[dict[str, Any]]:
    mode = config["mode"]
    if mode == "monolith":
        return [{"name": "monolith", "compose_file": "compose/monolith.yml", "profile": "full"}]
    if mode == "kubernetes":
        return [{"name": "kubernetes", "chart": "charts/dt-orch"}]

    services = config.get("distributed", {}).get("services", {})
    roles: list[dict[str, Any]] = []
    mapping = {
        "backend": ("api", "compose/roles/api.yml"),
        "worker": ("worker", "compose/roles/worker.yml"),
        "frontend": ("frontend", "compose/roles/frontend.yml"),
        "infra": ("infra", "compose/roles/infra.yml"),
    }
    for key, (role_name, compose_file) in mapping.items():
        svc = services.get(key)
        if not svc:
            continue
        entry: dict[str, Any] = {"name": role_name, "compose_file": compose_file}
        if svc.get("host"):
            entry["host"] = svc["host"]
        if svc.get("port"):
            entry["port"] = svc["port"]
        if svc.get("replicas"):
            entry["replicas"] = svc["replicas"]
        roles.append(entry)
    return roles


def render_manifest(config: dict[str, Any]) -> dict[str, Any]:
    """Deployment manifest consumed by install.sh."""
    mode = config["mode"]
    profile = "full" if mode == "monolith" else ("kubernetes" if mode == "kubernetes" else "distributed")
    return {
        "version": config["version"],
        "platform_version": config.get("app", {}).get("image_tag", "v1.0.0"),
        "mode": mode,
        "compose_profile": profile,
        "database_source": config["database"]["source"],
        "roles": _role_manifest(config),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def render_helm_values(config: dict[str, Any]) -> dict[str, Any]:
    """Optional Helm values snippet from deployment JSON."""
    reg = config.get("registry", {})
    app = config.get("app", {})
    tag = reg.get("image_tag") or app.get("image_tag", "v1.0.0")
    db_url, workspace_db_url, _, _, _ = _database_url(config)
    k8s = config.get("kubernetes", {})
    ingress_host = k8s.get("ingress_host", "studio.example.com")
    license_key = config.get("license", {}).get("key", "")
    values: dict[str, Any] = {
        "global": {"imageTag": tag},
        "registry": {"url": reg.get("url", "ghcr.io/YOUR_GITHUB_ORG")},
        "ingress": {
            "enabled": True,
            "host": ingress_host,
        },
        "database": {
            "url": db_url,
            "workspaceUrl": workspace_db_url,
        },
        "redis": {"url": _redis_url(config)},
        "secrets": {
            "licenseKey": license_key,
        },
        "frontend": {
            "build": {
                "nextPublicApiUrl": f"https://{ingress_host}/api/v1",
                "nextPublicKcUrl": f"https://{ingress_host}",
                "nextPublicKcRealm": config["keycloak"]["realm"],
                "nextPublicKcClientId": "workspace-web",
            }
        },
        "api": {
            "env": {
                "DATABASE_URL": db_url,
                "WORKSPACE_DATABASE_URL": workspace_db_url,
                "REDIS_URL": _redis_url(config),
                "PLATFORM_INFRA_URL": _platform_infra_url(config),
                "SANDBOX_ENABLED": str(app.get("sandbox_enabled", True)).lower(),
                "LICENSE_KEY": license_key,
            }
        },
    }
    if config["mode"] == "distributed":
        worker = config.get("distributed", {}).get("services", {}).get("worker", {})
        values["worker"] = {"replicas": worker.get("replicas", 1)}
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Render ELT deployment artifacts")
    parser.add_argument("--config", required=True, help="Path to deployment JSON")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--helm-values", action="store_true", help="Also write helm-values.yaml")
    args = parser.parse_args()

    config_path = Path(args.config)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    config = json.loads(config_path.read_text(encoding="utf-8"))
    env_content = render_env(config)
    manifest = render_manifest(config)

    (out_dir / ".env").write_text(env_content, encoding="utf-8")
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    (out_dir / "deployment.json").write_text(
        json.dumps(config, indent=2),
        encoding="utf-8",
    )

    if args.helm_values:
        helm_path = out_dir / "helm-values.json"
        helm_path.write_text(
            json.dumps(render_helm_values(config), indent=2),
            encoding="utf-8",
        )
        print(f"Rendered {helm_path}")

    print(f"Rendered {out_dir / '.env'}")
    print(f"Rendered {out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
