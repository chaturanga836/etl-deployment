# DT Orch BaaS — self-host install guide

This repo is the **official install surface** for **DT Orch** (self-hosted BaaS). Application source lives in separate repos; this repo pins image versions and provides Compose, Helm, and Terraform (skeleton).

| Path | Purpose |
|------|---------|
| [compose/installer.yml](compose/installer.yml) | **Setup wizard UI** (recommended first step) |
| [installer/](installer/) | Wizard frontend + orchestration API |
| [compose/monolith.yml](compose/monolith.yml) | Single-VM full stack |
| [compose/roles/](compose/roles/) | Distributed multi-VM roles |
| [charts/dt-orch/](charts/dt-orch/) | Kubernetes Helm chart |
| [schema/](schema/) | Deployment JSON schema + examples |
| [renderer/render.py](renderer/render.py) | Generate `.env` from JSON |
| [sdk/](sdk/) | Customer app SDKs (separate audience) |

## Setup wizard (recommended)

The guided installer is a **browser UI** — no manual `.env` editing. Collect super admin credentials, database settings, license (or 3-month trial), and deployment target, then deploy with **live log output** in the browser.

```bash
./scripts/setup-ui.sh
# Script prints the browser URL (EC2 public DNS/IP when available)
```

Open the URL shown in the terminal (default port **3000**). On AWS EC2, allow inbound **TCP 3000** (wizard) and **TCP 80** (platform after install) in the security group.

Wizard steps: Welcome → Deployment target (monolith / distributed / Kubernetes) → Registry → Super Admin → Database → License (optional trial) → Target config → Review → **Install** → Login URL.

**License:** click **Start 3-month trial** in the wizard, or paste a vendor key. If you skip the license step, a trial is issued automatically at install time.

**Vendor license keys** (signed offline JWT):

```bash
python scripts/generate-license-keys.py    # once (vendor)
python scripts/generate-license.py --customer-id acme-corp --days 365
```

The API validates `LICENSE_KEY` at startup in production.

**AI / troubleshooting reference:** [AI_REFERENCE.md](AI_REFERENCE.md) — **start with §2 Direct path** (installer UI → Install → verify login). Covers host paths, license keypairs, Keycloak health, Cython gotchas.

**Recovery rule:** fix in git → push → on host: `./scripts/fresh-install.sh --yes` → complete the **Install** step in the wizard again. Do not patch a failed install with manual scripts on the server.

The installer mounts the Docker socket to run `docker compose` on your behalf. Stop the installer container after setup if you no longer need the wizard (`docker compose -f compose/installer.yml down`).

## Fresh install (new EC2 or broken platform)

**Use one flow only.** Do not patch a half-working install with manual scripts (`bootstrap-*.py`, `pip install`, `rebuild-frontend-from-source.sh`, hand-edited `.env`). Fix bugs in `etl-deployment` / app repos, push, then run the **direct path** again:

1. `./scripts/fresh-install.sh --yes` — redeploy installer UI
2. Browser → complete all wizard steps → **Install**
3. Verify `http://<host>/login`

| What you fixed | Where to commit | Then on host |
|----------------|-----------------|--------------|
| Installer, compose, `install.sh`, Keycloak wait | `etl-deployment` | `git pull` → `fresh-install.sh --yes` → Install UI |
| Studio API / frontend | `etl-back` / `elt-frontend` → release image → bump `VERSION` in `etl-deployment` | `git pull` → `fresh-install.sh --yes` → Install UI |

### First time on EC2

```bash
sudo apt-get update && sudo apt-get install -y git docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
# log out and back in

git clone https://github.com/chaturanga836/etl-deployment.git
cd etl-deployment
./scripts/fresh-install.sh --yes
```

### Reset after a failed or broken install

```bash
cd ~/etl-deployment
./scripts/fresh-install.sh --yes
```

### What `fresh-install.sh` does

1. `git pull` — latest installer scripts and `VERSION`
2. `clean-platform.sh` — stops and removes all DT Orch containers, volumes (Postgres, wizard state), per-org Centrifugo brokers, and `data-plane-net`
3. `setup-ui.sh` — starts Install UI on port **3000**

### In the browser

1. Open `http://<EC2-public-ip>:3000`
2. Complete **every** wizard step (registry, super admin, database, license, **public host** = your EC2 IP)
3. Click **Install** on Confirm — watch live logs until done
4. Open `http://<EC2-public-ip>/login`

**EC2 security group:** inbound TCP **3000** (wizard), TCP **80** (platform).

`install.sh` (run by the wizard) builds the frontend image with your **public host** from the wizard — do not rely on pre-built GHCR frontend alone for Keycloak URLs.

### VERSION and images

`VERSION` in this repo must match tags that exist on GHCR for **all four** images (`dt-orch-api`, `dt-orch-frontend`, `baas-infra`, `dt-orch-scraper`). If the wizard reports images `not_found`, keep `VERSION` at the last complete release until CI publishes a new tag.

## Clean reinstall (standard recovery)

> **Deprecated section** — use [Fresh install](#fresh-install-new-ec2-or-broken-platform) above. Same command: `./scripts/fresh-install.sh --yes`.

## Databases (bundled Postgres)

On first start, `scripts/init-db.sql` creates:

| Database | Purpose |
|----------|---------|
| `dtorc_metadata` | Platform control plane (orgs, pipelines, connections) |
| `dtorc_workspace` | Per-workspace customer data / migrations |
| `keycloak` | Authentication (Keycloak) |

Configure names via `DTORC_METADATA_DB_NAME`, `DTORC_WORKSPACE_DB_NAME`, and `DATABASE_URL` / `WORKSPACE_DATABASE_URL` in `.env`.

## Prerequisites

- Docker 24+ with Compose v2
- Outbound HTTPS to pull public release images from GHCR (no GitHub account or token required)
- For air-gapped / closed-boundary sites: offline install bundle (see vendor)
- For dev builds: sibling repos `etl-back`, `elt-frontend`, `platform-infra-repo` checked out next to this repo

## Quick start — monolith (PoC)

**Preferred:** use the [setup wizard](#setup-wizard-recommended) above.

CLI alternative:
```bash
cp .env.platform.example .env
# Edit registry URL and secrets

./scripts/install.sh monolith full
# Or with local builds:
./scripts/install.sh --dev monolith full
```

## Config-driven install

```bash
./scripts/install.sh --config schema/examples/monolith-bundled.json full
```

## Distributed roles (multi-VM)

1. Render config:

```bash
python renderer/render.py --config schema/examples/distributed-aws-vm.json --out . --helm-values
```

2. On each host, copy `.env` and run the role:

```bash
docker compose -f compose/networks.yml up -d   # once
./scripts/install.sh --role api
./scripts/install.sh --role worker --scale 3
./scripts/install.sh --role frontend
./scripts/install.sh --role infra              # Docker socket host
```

## Kubernetes (Helm)

```bash
helm install dt-orch ./charts/dt-orch \
  -f charts/dt-orch/values.yaml \
  -f charts/dt-orch/values-external-db.yaml \
  --set global.imageTag=v1.0.0 \
  --set global.registry=registry.example.com/dt-orch \
  --set secrets.internalServiceToken="$(openssl rand -hex 32)" \
  --set secrets.fernetKey="$(openssl rand -base64 32)" \
  --set database.url="postgresql://..."
```

Generate Helm values from deployment JSON:

```bash
python renderer/render.py --config schema/examples/distributed-aws-vm.json --out /tmp/dtorch --helm-values
# Use /tmp/dtorch/helm-values.json to override chart values
```

## Upgrade

```bash
# Bump IMAGE_TAG in .env or re-render from config
./scripts/upgrade.sh full
```

## Release coordination

1. Tag `vX.Y.Z` on each app repo — GitHub Actions publishes images to GHCR (see [RELEASE.md](RELEASE.md))
2. Update [VERSION](VERSION) `platform` and `registry.url` (`ghcr.io/<org>`)
3. Tag `etl-deployment` `vX.Y.Z` (scraper image)

Release API images compile Python to bytecode and strip `.py` sources by default. See [CODE_PROTECTION.md](CODE_PROTECTION.md) for limits and stronger options.

## Internal SaaS deploy

Vendor production still uses Jenkins per app repo. This repo is for **customer self-host** and local PoC.

## Terraform (AWS)

Skeleton at [terraform/examples/aws-standard/](terraform/examples/aws-standard/). Expand with VPC, EKS, RDS, ElastiCache modules, then `helm_release`.
