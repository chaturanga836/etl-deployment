"""Build deployment.json from wizard payload."""

from __future__ import annotations

from typing import Any


def build_deployment_config(wizard: dict[str, Any]) -> dict[str, Any]:
    mode = wizard.get("deployment_mode", "monolith")
    db = wizard.get("database", {})
    source = db.get("source", "bundled")

    # Bundled installs leave password blank in the wizard; compose defaults POSTGRES_PASSWORD
    # to changeme, so an empty value here would desync DATABASE_URL from the running DB.
    db_password = (db.get("password") or "").strip() or "changeme"

    kc = wizard.get("keycloak") or {}
    redis_cfg = wizard.get("redis") or {}
    minio_cfg = wizard.get("minio") or {}
    centrifugo_cfg = wizard.get("centrifugo") or {}
    workspace_sql = wizard.get("workspace_sql") or {}
    mongo_cfg = wizard.get("mongo") or {}

    kc_admin_password = (
        (kc.get("admin_password") or "").strip()
        or (wizard.get("kc_admin_password") or "").strip()
        or db_password
    )

    ws_engine = (workspace_sql.get("engine") or "postgres").strip().lower()
    if ws_engine not in {"postgres", "mysql"}:
        raise ValueError("workspace_sql.engine must be 'postgres' or 'mysql'")

    # Monolith: one SQL instance for platform + Studio when Postgres is chosen.
    # Sync workspace_sql from the platform database block.
    if ws_engine == "postgres":
        ws_source = source
        ws_host = (db.get("host") or "").strip() or ("postgres" if source == "bundled" else "")
        ws_port = int(db.get("port") or 5432)
        ws_user = db.get("user", "elt")
        ws_password = db_password
        ws_db_name = db.get("workspace_db_name") or "dtorc_workspace"
    else:
        ws_source = workspace_sql.get("source") or "bundled"
        ws_password = (workspace_sql.get("password") or "").strip() or db_password
        if ws_source == "bundled":
            ws_host = (workspace_sql.get("host") or "").strip() or "mysql"
            ws_port = int(workspace_sql.get("port") or 3306)
            ws_user = workspace_sql.get("user") or "elt"
            ws_db_name = workspace_sql.get("database_name") or "dtorc_workspace"
        else:
            ws_host = (workspace_sql.get("host") or "").strip()
            if not ws_host:
                raise ValueError("workspace_sql.host is required for external MySQL")
            ws_port = int(workspace_sql.get("port") or 3306)
            ws_user = workspace_sql.get("user") or "elt"
            ws_db_name = workspace_sql.get("database_name") or "dtorc_workspace"

    mongo_source = (mongo_cfg.get("source") or "bundled").strip().lower()
    if mongo_source not in {"bundled", "external", "skip"}:
        raise ValueError("mongo.source must be 'bundled', 'external', or 'skip'")
    mongo_password = (mongo_cfg.get("password") or "").strip() or db_password
    if mongo_source == "bundled":
        mongo_host = (mongo_cfg.get("host") or "").strip() or "mongo"
        mongo_port = int(mongo_cfg.get("port") or 27017)
        mongo_user = mongo_cfg.get("user") or "elt"
        mongo_db_name = mongo_cfg.get("database_name") or "dtorc_mongo"
    elif mongo_source == "external":
        mongo_host = (mongo_cfg.get("host") or "").strip()
        if not mongo_host:
            raise ValueError("mongo.host is required for external MongoDB")
        mongo_port = int(mongo_cfg.get("port") or 27017)
        mongo_user = mongo_cfg.get("user") or "elt"
        mongo_db_name = mongo_cfg.get("database_name") or "dtorc_mongo"
    else:
        mongo_host = ""
        mongo_port = 27017
        mongo_user = ""
        mongo_db_name = ""
        mongo_password = ""

    config: dict[str, Any] = {
        "version": "1",
        "mode": mode,
        "registry": {
            "url": wizard.get("registry_url", "ghcr.io/YOUR_GITHUB_ORG"),
            "image_tag": wizard.get("image_tag", "v1.0.0"),
        },
        "database": {
            "source": source,
            "host": (db.get("host") or "").strip() or ("postgres" if source == "bundled" else ""),
            "port": int(db.get("port") or 5432),
            "user": db.get("user", "elt"),
            "password": db_password,
            "metadata_db_name": db.get("metadata_db_name", "dtorc_metadata"),
            "workspace_db_name": db.get("workspace_db_name", "dtorc_workspace"),
            "keycloak_db_name": db.get("keycloak_db_name", "keycloak"),
        },
        "workspace_sql": {
            "engine": ws_engine,
            "source": ws_source,
            "host": ws_host,
            "port": ws_port,
            "user": ws_user,
            "password": ws_password,
            "database_name": ws_db_name,
        },
        "mongo": {
            "source": mongo_source,
            "host": mongo_host,
            "port": mongo_port,
            "user": mongo_user,
            "password": mongo_password,
            "database_name": mongo_db_name,
        },
        "keycloak": {
            "source": kc.get("source", "bundled"),
            "host": (kc.get("host") or "").strip() or "localhost",
            "port": int(kc.get("port") or 8081),
            "admin_user": kc.get("admin_user") or wizard.get("kc_admin_user", "admin"),
            "admin_password": kc_admin_password,
            "realm": kc.get("realm") or wizard.get("kc_realm", "workspace-realm"),
            "admin_client_id": kc.get("admin_client_id") or "workspace-api",
            "admin_client_secret": kc.get("admin_client_secret") or "changeme-api-secret",
        },
        "redis": {
            "source": redis_cfg.get("source", "bundled"),
            "host": (redis_cfg.get("host") or "").strip() or "redis",
            "port": int(redis_cfg.get("port") or 6379),
            "password": (redis_cfg.get("password") or "").strip(),
        },
        "minio": {
            "source": minio_cfg.get("source", "bundled"),
            "host": (minio_cfg.get("host") or "").strip() or "platform-shared-minio-storage",
            "port": int(minio_cfg.get("port") or 9000),
            "access_key": (minio_cfg.get("access_key") or "").strip() or "minioadmin",
            "secret_key": (minio_cfg.get("secret_key") or "").strip() or "minioadmin",
            "bucket": (minio_cfg.get("bucket") or "").strip() or "data",
        },
        "centrifugo": {
            "source": centrifugo_cfg.get("source", "bundled"),
            "host": (
                "centrifugo"
                if centrifugo_cfg.get("source", "bundled") == "bundled"
                else ((centrifugo_cfg.get("host") or "").strip() or "localhost")
            ),
            "http_port": (
                8000
                if centrifugo_cfg.get("source", "bundled") == "bundled"
                else int(centrifugo_cfg.get("http_port") or 8001)
            ),
            "api_key": (centrifugo_cfg.get("api_key") or "").strip(),
            "token_hmac_secret_key": (centrifugo_cfg.get("token_hmac_secret_key") or "").strip(),
        },
        "app": {
            "name": wizard.get("app_name", "DT Orch"),
            "image_tag": wizard.get("image_tag", "v1.0.0"),
            "sandbox_enabled": wizard.get("sandbox_enabled", True),
        },
        "superadmin": {
            "username": wizard["superadmin_username"],
            "password": wizard["superadmin_password"],
            "email": wizard.get("superadmin_email"),
        },
        "license": {"key": wizard["license_key"]},
        "deploy_env": wizard.get("deploy_env", "development"),
    }

    if mode == "monolith":
        mono = wizard.get("monolith", {})
        public_host = (mono.get("public_host") or "localhost").strip()
        if "@" in public_host:
            raise ValueError(
                "Website address looks like an email. Enter this server's public IP "
                "or domain name (e.g. 13.200.160.10 or studio.example.com)."
            )
        kc_port = int(kc.get("port") or mono.get("keycloak_port") or 8081)
        config["monolith"] = {
            "public_host": public_host,
            "use_proxy": mono.get("use_proxy", True),
            "ports": {
                "http": int(mono.get("http_port", 80)),
                "frontend": int(mono.get("frontend_port", 3001)),
                "api": int(mono.get("api_port", 8000)),
                "keycloak": kc_port,
            },
        }
    elif mode == "distributed":
        dist = wizard.get("distributed", {})
        config["distributed"] = {
            "services": dist.get("services", {}),
            "aws": dist.get("aws", {}),
        }
        config["optional_features"] = {
            "scraper": wizard.get("scraper", "enabled"),
            "keycloak": "external" if kc.get("source") == "external" else "bundled",
        }
        if wizard.get("ssh"):
            config["ssh"] = wizard["ssh"]
    elif mode == "kubernetes":
        k8s = wizard.get("kubernetes", {})
        config["kubernetes"] = {
            "namespace": k8s.get("namespace", "dt-orch"),
            "ingress_host": k8s["ingress_host"],
            "kubeconfig_path": k8s.get("kubeconfig_path", ""),
        }

    return config
