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

    kc_admin_password = (
        (kc.get("admin_password") or "").strip()
        or (wizard.get("kc_admin_password") or "").strip()
        or db_password
    )

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
        kc_port = int(kc.get("port") or mono.get("keycloak_port") or 8081)
        config["monolith"] = {
            "public_host": mono.get("public_host", "localhost"),
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
