"""Deployment orchestration for monolith, distributed, and Kubernetes."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from app.config_builder import build_deployment_config
from app.deploy_phases import phase_from_log_line
from app.jobs import DeployJob, JobStatus
from app.release_manifest import compare_versions, load_platform_release

DEPLOYMENT_ROOT = Path(os.getenv("ETL_DEPLOYMENT_ROOT", "/opt/etl-deployment"))
STATE_DIR = Path(os.getenv("INSTALLER_STATE_DIR", "/opt/etl-deployment-state"))
SCRIPTS_DIR = DEPLOYMENT_ROOT / "scripts"


def _resolve_env_path() -> Path | None:
    """Match upgrade.sh / install.sh env file resolution."""
    if STATE_DIR.is_dir() and (STATE_DIR / ".env").is_file():
        return STATE_DIR / ".env"
    root_env = DEPLOYMENT_ROOT / ".env"
    if root_env.is_file():
        return root_env
    return None


def _read_env_value(env_path: Path, key: str) -> str | None:
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip()
    return None


def _upgrade_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    env["STATE_DIR"] = str(STATE_DIR)
    env["ETL_DEPLOYMENT_HOST_ROOT"] = os.getenv("ETL_DEPLOYMENT_HOST_ROOT", str(DEPLOYMENT_ROOT))
    env_path = _resolve_env_path()
    if env_path is not None:
        env["ENV_FILE"] = str(env_path)
    return env


def _installer_dev_build() -> bool:
    if os.getenv("INSTALLER_DEV_BUILD", "").lower() in ("1", "true", "yes"):
        return True
    return (Path("/opt/etl-back") / "Dockerfile").is_file()


def _login_url_from_env(env_path: Path) -> str:
    env: dict[str, str] = {}
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    base = env.get("APP_URL", "http://localhost")
    return urljoin(base.rstrip("/") + "/", "login")


def _login_url_from_k8s(ingress_host: str) -> str:
    return f"https://{ingress_host}/login"


async def _stream_process(job: DeployJob, cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None, prefix: str = "") -> int:
    job.push_log(f"$ {' '.join(cmd)}", prefix=prefix)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        env=env or os.environ.copy(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace")
        job.push_log(text, prefix=prefix)
        if not prefix:
            log_phase = phase_from_log_line(text)
            if log_phase:
                job.push_phase(
                    log_phase["key"],
                    label=log_phase["label"],
                    progress=log_phase["progress"],
                )
    return await proc.wait()


def _render_config(job: DeployJob, config: dict[str, Any]) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    config_path = STATE_DIR / "deployment.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    job.push_phase("render")
    job.push_log("Rendering deployment artifacts...")

    result = subprocess.run(
        [
            sys.executable,
            str(DEPLOYMENT_ROOT / "renderer" / "render.py"),
            "--config",
            str(config_path),
            "--out",
            str(STATE_DIR),
            "--helm-values",
        ],
        capture_output=True,
        text=True,
        cwd=str(DEPLOYMENT_ROOT),
        check=False,
    )
    for line in (result.stdout + result.stderr).splitlines():
        if line.strip():
            job.push_log(line)
    if result.returncode != 0:
        raise RuntimeError(f"render.py failed with code {result.returncode}")
    # Restrict .env permissions
    env_file = STATE_DIR / ".env"
    if env_file.is_file():
        os.chmod(env_file, 0o600)

    license_key = (config.get("license") or {}).get("key", "").strip()
    if license_key:
        license_path = STATE_DIR / "license.key"
        license_path.write_text(license_key, encoding="utf-8")
        os.chmod(license_path, 0o600)

    _SHARED = Path(__file__).resolve().parents[2] / "shared"
    if str(_SHARED.parent) not in sys.path:
        sys.path.insert(0, str(_SHARED.parent))
    from shared.license import license_key_directory  # noqa: E402

    key_dir = license_key_directory()
    shutil.copy2(key_dir / "license-public.pem", STATE_DIR / "license-public.pem")

    return env_file


async def _run_bootstrap(job: DeployJob, config: dict[str, Any], env_path: Path) -> None:
    job.push_phase("bootstrap")
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()

    realm_script = SCRIPTS_DIR / "bootstrap-keycloak-realm.py"
    super_script = SCRIPTS_DIR / "bootstrap-superadmin.py"

    py = sys.executable
    job.push_phase("bootstrap_keycloak")
    code = await _stream_process(job, [py, str(realm_script)], cwd=DEPLOYMENT_ROOT, env={**os.environ, **env})
    if code != 0:
        raise RuntimeError("Keycloak realm bootstrap failed")

    superadmin = config["superadmin"]
    job.push_phase("bootstrap_admin")
    code = await _stream_process(
        job,
        [
            py,
            str(super_script),
            "--username",
            superadmin["username"],
            "--password",
            superadmin["password"],
            "--email",
            superadmin.get("email") or f"{superadmin['username']}@users.local",
        ],
        cwd=DEPLOYMENT_ROOT,
        env={**os.environ, **env, "INSTALLER_STATE_DIR": str(STATE_DIR)},
    )
    if code != 0:
        raise RuntimeError("Superadmin bootstrap failed")

    bootstrap_token = env.get("INSTALL_BOOTSTRAP_TOKEN", "")
    api_url = env.get("APP_URL", "http://localhost")
    health_url = urljoin(api_url.rstrip("/") + "/", "health")
    setup_url = urljoin(api_url.rstrip("/") + "/", "api/v1/setup/complete")

    superadmin_meta_path = STATE_DIR / "superadmin.json"
    keycloak_user_id = superadmin["username"]
    if superadmin_meta_path.is_file():
        meta = json.loads(superadmin_meta_path.read_text(encoding="utf-8"))
        keycloak_user_id = meta.get("user_id", keycloak_user_id)

    for _ in range(30):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                hr = await client.get(health_url)
                if hr.status_code == 200:
                    break
        except httpx.HTTPError:
            pass
        await asyncio.sleep(2)
    else:
        raise RuntimeError("API health check failed before setup complete")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            setup_url,
            json={
                "username": superadmin["username"],
                "email": superadmin.get("email") or f"{superadmin['username']}@users.local",
                "keycloak_id": keycloak_user_id,
            },
            headers={"X-Install-Bootstrap-Token": bootstrap_token},
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Platform setup failed: {response.text}")


async def deploy_monolith(job: DeployJob, config: dict[str, Any]) -> str:
    env_path = _render_config(job, config)
    job.push_phase("deploy")
    job.push_log("Starting platform containers...")
    env = os.environ.copy()
    env["ENV_FILE"] = str(env_path)
    env["STATE_DIR"] = str(STATE_DIR)
    env["ETL_DEPLOYMENT_HOST_ROOT"] = os.getenv(
        "ETL_DEPLOYMENT_HOST_ROOT", str(DEPLOYMENT_ROOT)
    )

    install_sh = SCRIPTS_DIR / "install.sh"
    install_args = ["bash", str(install_sh), "--state-dir", str(STATE_DIR)]
    if _installer_dev_build():
        install_args.append("--dev")
    install_args.append("full")
    code = await _stream_process(
        job,
        install_args,
        cwd=DEPLOYMENT_ROOT,
        env=env,
    )
    if code != 0:
        raise RuntimeError(f"install.sh exited with code {code}")

    await _run_bootstrap(job, config, env_path)
    return _login_url_from_env(env_path)


async def deploy_distributed(job: DeployJob, config: dict[str, Any]) -> str:
    env_path = _render_config(job, config)
    manifest = json.loads((STATE_DIR / "manifest.json").read_text(encoding="utf-8"))
    roles = manifest.get("roles", [])
    ssh_cfg = config.get("ssh", {})
    ssh_user = ssh_cfg.get("user", "ubuntu")
    ssh_key = ssh_cfg.get("key_path")
    remote_path = ssh_cfg.get("remote_path", "/opt/etl-deployment")

    role_order = ["infra", "api", "worker", "frontend"]
    ordered = sorted(
        roles,
        key=lambda r: role_order.index(r["name"]) if r["name"] in role_order else 99,
    )

    env = os.environ.copy()
    env["STATE_DIR"] = str(STATE_DIR)
    env["ENV_FILE"] = str(env_path)

    for role_entry in ordered:
        role_name = role_entry["name"]
        host = role_entry.get("host")
        job.push_phase(f"role_{role_name}")
        prefix = f"[{role_name}] "

        if host and host not in ("localhost", "127.0.0.1") and ssh_key:
            ssh_base = ["ssh", "-o", "StrictHostKeyChecking=accept-new"]
            if ssh_key:
                ssh_base.extend(["-i", ssh_key])
            scp_base = ["scp", "-o", "StrictHostKeyChecking=accept-new"]
            if ssh_key:
                scp_base.extend(["-i", ssh_key])

            job.push_log(f"Copying artifacts to {ssh_user}@{host}:{remote_path}", prefix=prefix)
            await _stream_process(
                job,
                scp_base + [str(env_path), f"{ssh_user}@{host}:{remote_path}/.env"],
                cwd=DEPLOYMENT_ROOT,
                prefix=prefix,
            )
            await _stream_process(
                job,
                scp_base + [str(STATE_DIR / "deployment.json"), f"{ssh_user}@{host}:{remote_path}/deployment.json"],
                cwd=DEPLOYMENT_ROOT,
                prefix=prefix,
            )
            remote_cmd = (
                f"cd {remote_path} && bash scripts/install.sh --state-dir {remote_path} --role {role_name}"
            )
            code = await _stream_process(
                job,
                ssh_base + [f"{ssh_user}@{host}", remote_cmd],
                cwd=DEPLOYMENT_ROOT,
                prefix=prefix,
            )
        else:
            install_sh = SCRIPTS_DIR / "install.sh"
            scale_args: list[str] = []
            if role_name == "worker":
                replicas = role_entry.get("replicas")
                if replicas:
                    scale_args = ["--scale", str(replicas)]
            cmd = ["bash", str(install_sh), "--state-dir", str(STATE_DIR), "--role", role_name, *scale_args]
            code = await _stream_process(job, cmd, cwd=DEPLOYMENT_ROOT, env=env, prefix=prefix)

        if code != 0:
            raise RuntimeError(f"Role {role_name} failed with code {code}")

    await _run_bootstrap(job, config, env_path)
    return _login_url_from_env(env_path)


async def deploy_kubernetes(job: DeployJob, config: dict[str, Any]) -> str:
    env_path = _render_config(job, config)
    k8s = config.get("kubernetes", {})
    namespace = k8s.get("namespace", "dt-orch")
    ingress_host = k8s["ingress_host"]
    helm_values = STATE_DIR / "helm-values.json"

    job.push_phase("deploy")
    import secrets as secmod

    fernet = subprocess.check_output(["openssl", "rand", "-base64", "32"], text=True).strip()
    internal_token = secmod.token_hex(32)
    license_key = config.get("license", {}).get("key", "")

    bootstrap_token = ""
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("INSTALL_BOOTSTRAP_TOKEN="):
                bootstrap_token = line.split("=", 1)[1].strip()
                break

    cmd = [
        "helm",
        "upgrade",
        "--install",
        "dt-orch",
        str(DEPLOYMENT_ROOT / "charts" / "dt-orch"),
        "-n",
        namespace,
        "--create-namespace",
        "-f",
        str(helm_values),
        "--set",
        f"secrets.fernetKey={fernet}",
        "--set",
        f"secrets.internalServiceToken={internal_token}",
        "--set",
        f"secrets.licenseKey={license_key}",
        "--set",
        f"secrets.installBootstrapToken={bootstrap_token}",
        "--wait",
        "--timeout",
        "15m",
    ]
    kubeconfig = k8s.get("kubeconfig_path")
    env = os.environ.copy()
    if kubeconfig:
        env["KUBECONFIG"] = kubeconfig

    code = await _stream_process(job, cmd, cwd=DEPLOYMENT_ROOT, env=env)
    if code != 0:
        raise RuntimeError(f"helm exited with code {code}")

    job.push_phase("health_check")
    job.push_log("Waiting for ingress to become ready...")
    await asyncio.sleep(5)

    await _run_bootstrap(job, config, env_path)
    return _login_url_from_k8s(ingress_host)


async def run_deploy_job(job: DeployJob, wizard: dict[str, Any]) -> None:
    job.status = JobStatus.RUNNING
    job.push_phase("starting")
    try:
        config = build_deployment_config(wizard)
        mode = config["mode"]
        if mode == "monolith":
            login_url = await deploy_monolith(job, config)
        elif mode == "distributed":
            login_url = await deploy_distributed(job, config)
        elif mode == "kubernetes":
            login_url = await deploy_kubernetes(job, config)
        else:
            raise ValueError(f"Unknown deployment mode: {mode}")

        state = {
            "completed_at": job.created_at.isoformat(),
            "mode": mode,
            "login_url": login_url,
            "image_tag": config.get("app", {}).get("image_tag")
            or config.get("registry", {}).get("image_tag"),
        }
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        (STATE_DIR / "install-state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
        job.push_phase("complete")
        job.complete(login_url)
    except Exception as exc:
        job.fail(str(exc))
        job.push_log(f"ERROR: {exc}")


async def run_upgrade_job(job: DeployJob) -> None:
    job.status = JobStatus.RUNNING
    job.push_phase("upgrade_starting")
    try:
        env_path = _resolve_env_path()
        if env_path is None:
            raise RuntimeError("No installation found (.env missing). Run install first.")

        current_tag = _read_env_value(env_path, "IMAGE_TAG") or "v1.0.0"
        _, available_tag = load_platform_release()
        if compare_versions(current_tag, available_tag) >= 0:
            raise RuntimeError(f"Already on {current_tag}; no newer release in VERSION.")

        job.push_phase("upgrade_sync")
        upgrade_sh = SCRIPTS_DIR / "upgrade.sh"
        code = await _stream_process(
            job,
            ["bash", str(upgrade_sh), "full"],
            cwd=DEPLOYMENT_ROOT,
            env=_upgrade_runtime_env(),
        )
        if code != 0:
            raise RuntimeError(f"upgrade.sh exited with code {code}")

        login_url = _login_url_from_env(env_path)
        new_tag = _read_env_value(env_path, "IMAGE_TAG") or available_tag

        state_path = STATE_DIR / "install-state.json"
        state: dict[str, Any] = {}
        if state_path.is_file():
            state = json.loads(state_path.read_text(encoding="utf-8"))
        state.update(
            {
                "upgraded_at": job.created_at.isoformat(),
                "login_url": login_url,
                "image_tag": new_tag,
            }
        )
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

        job.push_phase("upgrade_complete")
        job.complete(login_url)
    except Exception as exc:
        job.fail(str(exc))
        job.push_log(f"ERROR: {exc}")
