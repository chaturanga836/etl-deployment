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

    config: dict[str, Any] = {
        "version": "1",
        "mode": mode,
        "registry": {
            "url": wizard.get("registry_url", "ghcr.io/YOUR_GITHUB_ORG"),
            "image_tag": wizard.get("image_tag", "v1.0.0"),
        },
        "database": {
            "source": source,
            "user": db.get("user", "elt"),
            "password": db_password,
            "metadata_db_name": db.get("metadata_db_name", "dtorc_metadata"),
            "workspace_db_name": db.get("workspace_db_name", "dtorc_workspace"),
            "keycloak_db_name": db.get("keycloak_db_name", "keycloak"),
        },
        "keycloak": {
            "admin_user": wizard.get("kc_admin_user", "admin"),
            "admin_password": wizard.get("kc_admin_password") or db_password,
            "realm": wizard.get("kc_realm", "workspace-realm"),
            "admin_client_id": "admin-cli",
            "admin_client_secret": "",
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

    if source == "external":
        config["database"]["host"] = db["host"]
        config["database"]["port"] = int(db.get("port", 5432))

    if mode == "monolith":
        mono = wizard.get("monolith", {})
        config["monolith"] = {
            "public_host": mono.get("public_host", "localhost"),
            "use_proxy": mono.get("use_proxy", True),
            "ports": {
                "http": int(mono.get("http_port", 80)),
                "frontend": int(mono.get("frontend_port", 3001)),
                "api": int(mono.get("api_port", 8000)),
                "keycloak": int(mono.get("keycloak_port", 8081)),
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
            "keycloak": "external",
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
