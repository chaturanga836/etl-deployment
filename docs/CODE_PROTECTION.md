# Protecting platform code in self-hosted deployments

Self-hosted customers run your container images on **their** infrastructure. Anyone with Docker or host access can inspect containers. This document explains what protection is realistic, what we ship by default, and stronger options.

## Public registry vs private git

| What | Default | What customers get |
|------|---------|-------------------|
| Git repos (`etl-back`, `elt-frontend`, …) | **Private** | No access |
| GHCR images (`dt-orch-api`, …) | **Public** | `docker pull` without your GitHub token |
| Logic inside images | **Protected build** | Cython `.so`, compiled Next.js — not raw source |

Making container images public on GHCR does **not** publish your git repositories. Customers download runnable binaries, not cloneable source.

## Threat model

| Actor | Capability |
|-------|------------|
| Platform end-user (UI) | Cannot read your Python/TS source; sandbox limits task scripts |
| Customer admin with `docker exec` | Can read files inside running containers |
| Determined customer | Can `docker save`, extract image layers, disassemble `.so`, sniff env vars |

**There is no way to give a customer a runnable copy of proprietary logic on their hardware and fully prevent a skilled admin from reverse engineering it.** Protection is about **raising cost** and combining **technical + legal** controls.

## What we ship today

### API / worker image (`dt-orch-api`)

Release builds use `SOURCE_PROTECTION=1` (see `etl-back/Dockerfile`):

1. **Cython** — `core/`, `services/`, `api/`, `models/`, `schemas/`, `plugins/`, `prototypes/`, `task/`, `main.py`, and `sandbox/executor.py` compile to native `*.cpython-*.so` extensions; `.py` sources are removed
2. **Bytecode strip** — any remaining `.py` (e.g. `sandbox/runner.py`) is compiled to `__pycache__` and stripped
3. **Dev tree removal** — `tests/`, `jenkins/`, `scripts/`, etc. excluded via `.dockerignore` and deleted at build

**Always kept as `.py`:**

- `alembic/env.py` and `alembic/versions/*` (Alembic loads migrations by path)
- `sandbox/runner.py` (executes user task code via `exec()`)

After protection, `docker exec dt-orch-api ls /app/services` shows `.so` files, not readable Python source.

**Build release images:**

```bash
docker build --build-arg SOURCE_PROTECTION=1 -t dt-orch-api:release ../etl-back
```

Tagged releases via GitHub Actions and `scripts/release/build-and-push.sh` enable this by default.

**Build scripts:**

| File | Role |
|------|------|
| `scripts/cythonize_release.py` | Cython compile + strip `.py` / `.c` |
| `scripts/compile_release_tree.py` | Bytecode + strip for non-Cython modules |
| `requirements-cython-build.txt` | Build-time Cython deps (not in runtime image) |

### Frontend image (`dt-orch-frontend`)

Already ships compiled Next.js output (`.next/`), not raw `src/`. Casual source browsing is limited; bundles can still be analyzed.

### Infra / scraper

Smaller Python surface. Apply the same Cython pattern if you need parity.

## Protection tiers

| Tier | Effort | Stops casual `docker exec`? | Stops skilled reverse engineer? |
|------|--------|------------------------------|----------------------------------|
| **1 — Bytecode strip** | Low | Mostly | No — `.pyc` decompilers exist |
| **2 — Cython `.so`** (default release) | Medium | Yes for Python source | Partially — disassembly possible |
| **3 — PyArmor / Nuitka** | Medium–high | Yes | Slows further |
| **4 — Hybrid SaaS** | Architectural | N/A | Keep sensitive engines in your cloud |
| **5 — Legal** | Required | N/A | EULA + license key |

## Additional hardening (recommended)

- **Public GHCR images, private git repos** — customers `docker pull` without your GitHub token; source repos stay private
- **Image-level protection** — Cython `.so` and compiled frontend (see above); registry privacy is not the protection layer
- **Secrets outside env** — vault / K8s Secrets; avoid `docker exec … env` leaking `FERNET_KEY`
- **Limit `docker.sock`** — `infra-service` with socket access is equivalent to root on the host
- **Non-root containers** — limits tampering, not reading

## What Cython protection does *not* do

- Does not encrypt image layers (layers are still extractable)
- Does not make native `.so` files impossible to reverse (Ghidra/IDA still apply)
- Does not hide Alembic migration files (kept as `.py` by design)
- Does not protect against a customer who obtains source from another leak

## Verifying a release image

```bash
docker run --rm dt-orch-api:release ls /app/services | head
# Expect *.cpython-*.so files, not *.py

docker run --rm dt-orch-api:release find /app -name '*.py' | head
# Expect alembic/env.py, alembic/versions/*.py, sandbox/runner.py

docker run --rm dt-orch-api:release python -c "import main; print('ok')"
docker run --rm dt-orch-api:release python -c "from services.sync_service import PipelineExecutorService; print('ok')"
```

## Further hardening

1. **License enforcement** — signed license file checked at API startup
2. **Hybrid architecture** — proprietary connectors/catalog sync stay in vendor-hosted API
3. **Cython for infra/scraper** — same pipeline in those Dockerfiles
