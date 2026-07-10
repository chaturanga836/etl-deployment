# DT Orch self-host — AI agent reference

Dense operational and architectural reference for AI assistants working on **DT Orch** self-hosted deployments. Human-oriented guides: [INSTALL.md](INSTALL.md), [RELEASE.md](RELEASE.md), [CODE_PROTECTION.md](CODE_PROTECTION.md).

---

## 1. Repository map

| Repo | Role |
|------|------|
| **etl-deployment** | Install surface: Compose, Helm, installer wizard, `VERSION` manifest, scripts |
| **etl-back** | API + Celery worker (`dt-orch-api` image), Alembic, license validation |
| **elt-frontend** | Next.js UI (`dt-orch-frontend` image) |
| **platform-infra-repo** | BaaS infra service (`baas-infra` image) |

**Release images** (pinned in `VERSION`):

```
ghcr.io/chaturanga836/dt-orch-api:vX.Y.Z
ghcr.io/chaturanga836/dt-orch-frontend:vX.Y.Z
ghcr.io/chaturanga836/baas-infra:vX.Y.Z
ghcr.io/chaturanga836/dt-orch-scraper:vX.Y.Z
```

Release API images are built with `SOURCE_PROTECTION=1` (Cython + source strip). See [CODE_PROTECTION.md](CODE_PROTECTION.md).

---

## 2. Installation paths (do not confuse them)

### Recommended: setup wizard (browser UI)

```bash
./scripts/setup-ui.sh
# → http://<host>:3000
```

- Compose file: `compose/installer.yml`
- Container: `dt-orch-installer` (port 3000 → internal 8080)
- Wizard code: `installer/frontend/`, `installer/backend/`
- On **Install**, orchestrator runs `scripts/install.sh --state-dir /opt/etl-deployment-state full`
- State volume: `installer_state` → `/opt/etl-deployment-state`

**Wizard steps:** Welcome → Type → Account → Database → License → Website → Confirm → Installing → Done

### Alternative: CLI (no wizard)

```bash
cp .env.platform.example .env   # edit secrets
./scripts/install.sh monolith full
```

Skips super-admin bootstrap UI flow; uses defaults from `VERSION` / `.env`. Good for PoC; **not** a substitute for first-time wizard setup.

### Config-driven

```bash
./scripts/install.sh --config schema/examples/monolith-bundled.json full
```

---

## 3. Runtime topology (monolith `full` profile)

| Container | Image | Notes |
|-----------|-------|-------|
| `elt-postgres` | postgres:16-alpine | DBs: `dtorc_metadata`, `dtorc_workspace`, `keycloak` |
| `elt-redis` | redis:7.2-alpine | Celery broker |
| `dt-orch-api` | dt-orch-api | FastAPI; Alembic on start; license check in production |
| `dt-orch-worker` | dt-orch-api | Same image, worker entrypoint |
| `dt-orch-frontend` | dt-orch-frontend | Bound to `127.0.0.1:3001` |
| `baas-infra-service` | baas-infra | Port 9000 |
| `dt-orch-scraper` | dt-orch-scraper | Port 8088 |
| `elt-keycloak` | keycloak:26.0.0 | Loopback `:8081` only; browser uses nginx `/realms/` on `:80` |
| `elt-proxy` | nginx:1.27-alpine | Port 80; depends on healthy API |

Compose: `compose/monolith.yml` (profile `full`).

**Health:** installer `install.sh` waits for Keycloak at `http://host.docker.internal:8081/realms/master` when run inside the wizard container (not `localhost` — that is the installer itself). Then API health at `http://localhost/health` (via proxy on the host network). Bootstrap scripts run **inside the installer container** (Python + `httpx` preinstalled).

**Post-install bootstrap (automatic via wizard only):**

1. `scripts/install.sh --state-dir /opt/etl-deployment-state full` (includes Keycloak wait)
2. `scripts/bootstrap-keycloak-realm.py` — import `workspace-realm`
3. `scripts/bootstrap-superadmin.py` — create super admin from wizard credentials
4. `POST /api/v1/setup/complete` — register platform super admin

Orchestrator: `installer/backend/app/orchestrator.py` → `_run_bootstrap()`. **Do not run bootstrap scripts manually on the host** during customer installs; fix the wizard flow instead.

---

## 4. Installer container vs host Docker (critical)

The wizard runs **inside** `dt-orch-installer` with:

- Repo mounted read-only at `/opt/etl-deployment`
- Docker socket mounted → starts platform containers on **host** daemon
- State at `/opt/etl-deployment-state`

Host bind mounts in `compose/monolith.yml` use **`ETL_DEPLOYMENT_HOST_ROOT`**, the real checkout path on the host (e.g. `/home/ubuntu/etl-deployment`), **not** `/opt/etl-deployment`.

### Required bind-mount files (under host root)

```
nginx/default.conf
nginx/ssl.conf.template
scripts/proxy-entrypoint.sh
scripts/init-db.sql
config/license-public.pem
```

Resolved in `scripts/install.sh` → `bind_mount_rel_paths()`, `preflight_bind_mounts()`.

### Host path resolution (`scripts/install.sh`)

Order when `running_installer_with_docker_sock` (inside installer):

1. `ETL_DEPLOYMENT_HOST_ROOT` env if set and valid on host
2. `docker inspect dt-orch-installer` → mount source for `/opt/etl-deployment`
3. `docker inspect $HOSTNAME`
4. `/proc/self/mountinfo` awk on mount point `/opt/etl-deployment`

**Validation must use host filesystem**, not `[[ -d "$path" ]]` inside the installer container (host path is not visible there). Use `docker run alpine test -d "/host${path}"`.

`./scripts/setup-ui.sh` sets:

```bash
export ETL_DEPLOYMENT_HOST_ROOT="$ROOT_DIR"
```

Passed through `compose/installer.yml`. **Always start wizard via `setup-ui.sh`**, or export `ETL_DEPLOYMENT_HOST_ROOT` manually.

### Failure signature

```
ERROR: Cannot resolve the host path for /opt/etl-deployment bind mounts.
ERROR: Required file missing on host for Docker bind mount: /opt/etl-deployment/nginx/default.conf
```

Second line means fallback to container path — fix host root resolution.

---

## 5. License system

Two distinct artifacts:

| Artifact | Files / env | Purpose |
|----------|-------------|---------|
| **RSA keypair** | `config/license-public.pem`, `config/license-private.pem` | Sign/verify license JWTs |
| **License JWT** | `LICENSE_KEY` in `.env` | What API validates at startup |

### Validation (API)

- Code: `etl-back/services/license_service.py`
- Public key: `LICENSE_PUBLIC_KEY_PATH` or `ETL_DEPLOYMENT_CONFIG_ROOT/license-public.pem` or bundled `config/license-public.pem`
- In production (`DTORCH_ENV=production`): `LICENSE_KEY` required
- In development: invalid/missing key is warned and ignored

API mount (monolith): host `config/license-public.pem` → `/etc/dt-orch/license-public.pem`

### Trial vs vendor license

| Mode | Who signs | Private key location |
|------|-----------|----------------------|
| **Free trial** (wizard) | Installer on customer server | `config/license-private.pem` (gitignored) |
| **Vendor license** | Vendor only | Never on customer server; use `scripts/generate-license.py` |

Trial flow: `POST /api/license/trial` → `installer/shared/license.py` → `issue_trial_license()`.

Vendor flow:

```bash
python scripts/generate-license-keys.py --out-dir config   # vendor once
python scripts/generate-license.py --customer-id acme --days 365
```

Customer pastes JWT in wizard **Activate license** step.

### Git tracking trap

- `config/license-public.pem` — **tracked in git**
- `config/license-private.pem` — **gitignored** (`.gitignore`)

After `git pull`, public key may update while private stays old → **mismatched pair** → `Invalid license key: Signature verification failed`.

**Fix:** `python3 scripts/repair-license-keys.py --out-dir config`  
**Prevention:** `setup-ui.sh` runs repair when both files exist; `installer/shared/license.py` validates pair with crypto sign/verify before use.

Key modules:

- `installer/shared/license.py` — `keypair_is_valid()`, `ensure_license_keypair()`, `license_key_directory()`
- `scripts/repair-license-keys.py` — CLI repair
- `scripts/generate-license-keys.py` — create new pair
- `scripts/generate-license.py` — vendor JWT issuance

---

## 6. Cython + Pydantic (API startup)

Release `dt-orch-api` Cythonizes most packages (`etl-back/scripts/cythonize_release.py`).

**Two constructs must never be Cythonized** (both caused mid-install crashes on fresh deploys):

- **Methods on Pydantic `BaseSettings`** → Cython turns them into `cyfunction`; Pydantic v2 treats them as unannotated fields → crash during Alembic (`cors_allow_origins`, v1.0.0).
- **FastAPI param helpers in route/dependency signatures** — both `Annotated[..., Depends(...)]` and plain `x: T = Depends(...)` break when Cythonized (`keycloak_auth` v1.0.1; entire `api/v1/*` layer on v1.0.2 first smoke-test attempt).

### Guardrails (as of v1.0.2 — a broken image can no longer ship)

`cythonize_release.py` now:

1. **Auto-detects** the two unsafe constructs (`_cython_unsafe_reason()`) and keeps those modules as pure Python, so `KEEP_PY_EXACT` can no longer silently drift when a new dependency module is added.
2. **Runs an import smoke test** (`smoke_test_release()`) after the build — it imports `main` in a clean interpreter, exactly as uvicorn does. If any Cythonized module is broken, **the release build fails** instead of publishing an image that crashes on the customer's fresh install.

So the failure mode moved from "customer's fresh install crash-loops" to "the vendor's CI build fails with a clear message."

### Fix workflow when a new crash appears

1. Fix the source (move logic off `BaseSettings`, or the smoke test will point at the crashing module).
2. If the auto-detector missed it, add the file to `KEEP_PY_EXACT` in `cythonize_release.py`. Prefer extending `_cython_unsafe_reason()` so the whole class is covered.
3. Tag `etl-back vX.Y.Z` → CI builds (`SOURCE_PROTECTION=1`) and the smoke test gates the publish.
4. Bump `etl-deployment/VERSION`; customer host: `./scripts/upgrade.sh full`.

**Always kept as `.py`:** `core/config.py`, `alembic/**`, `sandbox/runner.py`. **Auto-kept (bytecode, not native):** any module matching `_cython_unsafe_reason()`.

---

## 7. Key environment variables

| Variable | Where set | Meaning |
|----------|-----------|---------|
| `ETL_DEPLOYMENT_HOST_ROOT` | `setup-ui.sh` → installer env | Host path to etl-deployment checkout |
| `ETL_DEPLOYMENT_ROOT` | installer env | `/opt/etl-deployment` inside wizard |
| `INSTALLER_STATE_DIR` | installer env | `/opt/etl-deployment-state` |
| `STATE_DIR` / `--state-dir` | install.sh | Wizard-rendered `.env` location |
| `ENV_FILE` | install.sh | `.env` used by compose |
| `DTORCH_ENV` | `.env` | `production` enforces license |
| `LICENSE_KEY` | wizard render → `.env` | Signed JWT |
| `LICENSE_PUBLIC_KEY_PATH` | compose monolith | `/etc/dt-orch/license-public.pem` in API |
| `IMAGE_TAG` / `VERSION` | `VERSION` file | Image tag for all services |
| `SOURCE_PROTECTION` | etl-back Docker build | `1` = Cython release build |

---

## 8. Scripts index

| Script | Purpose |
|--------|---------|
| `scripts/setup-ui.sh` | Start wizard; repair license keys; set `ETL_DEPLOYMENT_HOST_ROOT` |
| `scripts/install.sh` | Main deploy: compose up, preflight, registry check |
| `scripts/repair-license-keys.py` | Ensure matching RSA pair in `config/` |
| `scripts/generate-license-keys.py` | Create new RSA pair |
| `scripts/generate-license.py` | Vendor: sign license JWT |
| `renderer/render.py` | JSON config → `.env` + manifest |

Installer orchestration: `installer/backend/app/orchestrator.py` → `deploy_monolith()` calls `install.sh`.

---

## 9. Debugging playbook

### API / worker crash-looping

```bash
docker logs dt-orch-api --tail 80
docker logs dt-orch-worker --tail 80
```

Common causes: Alembic/Pydantic (Cython), missing `LICENSE_KEY` in production, DB not ready.

### Proxy restart loop

Usually API unhealthy. Fix API first.

### Wizard deploy fails at install.sh

1. Check `ETL_DEPLOYMENT_HOST_ROOT` in installer:  
   `docker exec dt-orch-installer printenv ETL_DEPLOYMENT_HOST_ROOT`
2. Should be `/home/ubuntu/etl-deployment` (host path), not empty or `/opt/etl-deployment`
3. Restart via `./scripts/setup-ui.sh`

### License trial fails in wizard

```bash
python3 scripts/repair-license-keys.py --out-dir config
docker compose -f compose/installer.yml restart
```

### Stale bind-mount directories on host

Docker may create directories when files were missing. `install.sh` → `cleanup_stale_host_bind_mounts()`. Manual: `sudo rm -rf /path/to/etl-deployment/nginx/default.conf` if it's a directory, restore from repo.

### Tear down monolith stack

```bash
docker compose -f compose/monolith.yml --env-file .env --profile full down
```

Without `--env-file`, compose warns about unset `KC_*` / `DATABASE_URL` variables.

### Clean reinstall (wizard only — preferred)

**Standard recovery when anything is broken.** One command:

```bash
cd ~/etl-deployment
./scripts/fresh-install.sh --yes
```

`fresh-install.sh` → `git pull` → `clean-platform.sh` → `setup-ui.sh`. Then complete Install in the browser.

Equivalent:

```bash
git pull
./scripts/clean-platform.sh --yes
./scripts/setup-ui.sh -d
```

`clean-platform.sh` also removes per-org Centrifugo brokers (`org-*-centrifugo-broker`) and `data-plane-net`.

### Keycloak bootstrap failed (`Connection refused` on localhost:8081)

**Root cause:** `install.sh` and bootstrap scripts ran **inside the installer container**, where `localhost:8081` is not the host-published Keycloak port. Keycloak may already be healthy on the host.

**Fix in code:** `compose/installer.yml` adds `host.docker.internal:host-gateway`; `install.sh` and `kc_bootstrap_common.py` use `http://host.docker.internal:${KEYCLOAK_PORT}` when `/.dockerenv` + Docker socket are present.

**Agent rule:** do **not** tell users to `pip install httpx` or run bootstrap scripts on the host. Recreate the installer (`./scripts/setup-ui.sh` or `reinstall.sh`) so `extra_hosts` applies, then redo Install in the UI.

### Keycloak admin shows "HTTPS required" on `http://<public-ip>:8081`

**Root cause:** Keycloak rejects plain HTTP from **public** (non-private) IPs when hit directly on port 8081.

**Fix in code:** nginx proxies `/realms/`, `/resources/`, `/admin/` on port 80; `NEXT_PUBLIC_KC_URL` = `APP_URL`; Keycloak published on `127.0.0.1:8081` only; bootstrap sets `master` realm `sslRequired=none`.

**Use:** `http://<host>/admin/` (port 80), not `:8081` on a public IP.

### git pull blocked on server

Local edits (often `scripts/setup-ui.sh`):

```bash
git checkout -- scripts/setup-ui.sh
git pull
```

### Pull latest images after tag bump

```bash
git pull   # VERSION / IMAGE_TAG updated
./scripts/setup-ui.sh   # or ./scripts/install.sh full
```

---

## 10. Release workflow (for agents changing versions)

1. Fix/merge in **etl-back** (and other app repos)
2. Tag app repos `vX.Y.Z`; CI builds images with `SOURCE_PROTECTION=1`
3. Update **etl-deployment** `VERSION` (`platform`, `IMAGE_TAG`)
4. Customer `git pull` + reinstall / wizard redeploy

**Breaking API fixes require a new image tag** — editing source locally does not affect running `ghcr.io/.../dt-orch-api:v1.0.0`.

---

## 11. AI agent guidelines

### Do

- Prefer **wizard** (`setup-ui.sh`) for customer first-time install
- Use **`./scripts/fresh-install.sh --yes`** when any install/platform piece is broken (standard recovery)
- Set / verify `ETL_DEPLOYMENT_HOST_ROOT` when debugging installer deploys
- Run `repair-license-keys.py` when license signature errors appear after `git pull`
- Keep Pydantic settings/models out of Cython targets; use module-level functions
- Match existing bash/Python patterns in `scripts/` and `installer/`
- Bump `VERSION` / image tag when API fixes must reach deployed containers

### Do not

- Assume `./scripts/install.sh` alone replaces the wizard for greenfield setup
- **Suggest manual host-side fixes** (`pip install httpx`, `python3 scripts/bootstrap-*.py`, hand-editing `.env`) for customer installs — use `./scripts/reinstall.sh` + Install UI instead
- Use `[[ -d "$host_path" ]]` inside installer container to validate host paths
- Commit `license-private.pem`
- Put instance methods on `BaseSettings` in Cythonized `etl-back` packages
- Tell users to `git pull` without handling local `setup-ui.sh` conflicts

### Typical fix locations

| Symptom | Likely file(s) |
|---------|----------------|
| Bind mount / host path | `scripts/install.sh`, `scripts/setup-ui.sh`, `compose/installer.yml` |
| License trial / signature | `installer/shared/license.py`, `scripts/repair-license-keys.py` |
| API won't start (Pydantic/Cython) | `etl-back/core/config.py`, `etl-back/scripts/cythonize_release.py` |
| Keycloak bootstrap / realm import | `scripts/kc_bootstrap_common.py`, `scripts/install.sh`, `compose/monolith.yml`, `installer/backend/app/orchestrator.py` |
| Compose / service wiring | `compose/monolith.yml` |
| Image versions | `VERSION`, `.env.platform.example` |

---

## 12. Related paths (quick open)

```
etl-deployment/
  compose/installer.yml          # Wizard container
  compose/monolith.yml           # Full stack
  installer/shared/license.py    # Trial + validation
  installer/backend/app/orchestrator.py
  scripts/install.sh
  scripts/setup-ui.sh
  scripts/fresh-install.sh
  scripts/clean-platform.sh
  config/license-public.pem      # Tracked; must match private key on host

etl-back/
  services/license_service.py    # API runtime license check
  core/config.py                 # Settings (keep as .py)
  scripts/cythonize_release.py   # SOURCE_PROTECTION build
  Dockerfile                     # SOURCE_PROTECTION=1
```

---

*Last updated for issues encountered in v1.0.0–v1.0.3 self-host installs: Cython/Pydantic `cors_allow_origins`, license keypair mismatch after git pull, installer `ETL_DEPLOYMENT_HOST_ROOT` bind-mount resolution, Keycloak bootstrap race (wait before realm import).*
