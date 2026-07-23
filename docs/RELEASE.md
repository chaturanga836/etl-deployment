# Releasing DT Orch container images

Images are published to **GitHub Container Registry (GHCR)** on git tag push (`v*.*.*`).

| Image | Source repo | Dockerfile |
|-------|-------------|------------|
| `dt-orch-api` | `etl-back` | `Dockerfile` |
| `dt-orch-frontend` | `elt-frontend` | `Dockerfile` |
| `baas-infra` | `platform-infra-repo` | `infra-service/Dockerfile` |
| `dt-orch-scraper` | `etl-deployment` | `scraper-service/Dockerfile` |

## Registry model (customers vs source code)

| Asset | Visibility | Customer needs |
|-------|------------|----------------|
| **Git repos** (`etl-back`, etc.) | Private | Nothing — no repo access |
| **GHCR container images** | **Public** (default) | `docker pull` only — **no GitHub token** |
| **Source inside images** | Protected | Cython `.so`, compiled Next.js — see [CODE_PROTECTION.md](CODE_PROTECTION.md) |

Public images do **not** expose your git history or raw Python/TypeScript source. Protection is **in the image build**, not registry login.

Release CI sets each package to **public** automatically after push. For images already published as private, run once:

```bash
gh auth login
./scripts/release/set-packages-public.sh chaturanga836
```

Set `registry.public: false` in [VERSION](VERSION) only for enterprise customers who pull from a private mirror (they use **their own** GitHub PAT after you grant package access — never your token).

## One-time setup (GitHub)

1. **Frontend build URLs (optional)** — In `elt-frontend` repo → Settings → Secrets and variables → Actions → Variables:
   - `NEXT_PUBLIC_API_URL` (e.g. `https://studio.example.com/api/v1`)
   - `NEXT_PUBLIC_KC_URL`
   - `NEXT_PUBLIC_KC_REALM` (default `workspace-realm`)
   - `NEXT_PUBLIC_KC_CLIENT_ID` (default `workspace-web`)

If unset, release builds use localhost defaults. **Customer installs rebuild the frontend on the host** with the wizard public host so Keycloak login works (do not rely on the GHCR frontend alone for multi-tenant IPs).

## Release a version

### Automated (recommended)

1. Merge fixes to `master` on app repos (e.g. `etl-back`).
2. **Backend CI** runs lint, tests, and a **Cython release smoke build**; on success it dispatches **Platform release** in `etl-deployment`.
3. **Platform release** bumps [VERSION](VERSION) patch, commits, and tags `vX.Y.Z` on all repos — each repo's `release.yml` publishes GHCR images.
4. Customer upgrade (fully automated on the host):

```bash
./scripts/upgrade.sh full
```

`upgrade.sh` pulls the latest `etl-deployment` manifest, syncs `IMAGE_TAG` from `VERSION` into `.env`, pulls images, and recreates services. It also rebuilds the frontend with the public host from `.env` (unless `UPGRADE_REBUILD_FRONTEND=false`).

**Important:** [VERSION](VERSION) `platform` must match a tag where **all four** GHCR images exist (`dt-orch-api`, `dt-orch-frontend`, `baas-infra`, `dt-orch-scraper`). If only some images are published (e.g. scraper `v1.0.4` but API still `v1.0.3`), keep `VERSION` at the last complete release. For a **frontend-only** fix, install at the last complete tag and run `scripts/rebuild-frontend-from-source.sh` on the server if needed.

**One-time CI setup:** add org/repo secret `RELEASE_PAT` (PAT with `repo` + `workflow` on all DT Orch repos) to `etl-back` and `etl-deployment`. For GHCR visibility automation on personal accounts, also add `PACKAGES_TOKEN` (PAT with `write:packages`, or include that scope on `RELEASE_PAT`).

Manual trigger: **Actions → Platform release → Run workflow** (optional `version` or `bump`).

### Manual tag push (legacy)

Tag the **same version** on each repo (example `v1.0.0`):

```bash
# etl-back
git tag v1.0.0 && git push origin v1.0.0

# elt-frontend
git tag v1.0.0 && git push origin v1.0.0

# platform-infra-repo
git tag v1.0.0 && git push origin v1.0.0

# etl-deployment (scraper + bump VERSION)
git tag v1.0.0 && git push origin v1.0.0
```

Each push triggers `.github/workflows/release.yml` and publishes:

```text
ghcr.io/<github-owner>/dt-orch-api:v1.0.0
ghcr.io/<github-owner>/dt-orch-frontend:v1.0.0
ghcr.io/<github-owner>/baas-infra:v1.0.0
ghcr.io/<github-owner>/dt-orch-scraper:v1.0.0
```

Also tagged: `1.0.0` (without `v`) and `latest` on the newest release.

## Customer install `.env`

```bash
REGISTRY_URL=ghcr.io/<github-owner>
IMAGE_TAG=v1.0.0
API_IMAGE=${REGISTRY_URL}/dt-orch-api:${IMAGE_TAG}
FRONTEND_IMAGE=${REGISTRY_URL}/dt-orch-frontend:${IMAGE_TAG}
INFRA_IMAGE=${REGISTRY_URL}/baas-infra:${IMAGE_TAG}
SCRAPER_IMAGE=${REGISTRY_URL}/dt-orch-scraper:${IMAGE_TAG}
```

No `docker login` required when packages are public (default).

Private packages (optional enterprise): customer uses **their** GitHub account after you grant read access:

```bash
echo $THEIR_GITHUB_TOKEN | docker login ghcr.io -u THEIR_USERNAME --password-stdin
```

## Manual push (no GitHub Actions)

```bash
export REGISTRY=ghcr.io/your-org
export VERSION=v1.0.0
./scripts/release/build-and-push.sh all
./scripts/release/set-packages-public.sh your-org
```

Run from `etl-deployment` with sibling repos checked out.

## After release

1. Update [VERSION](VERSION) `platform:` and `registry.url` if needed.
2. Customer upgrade: `./scripts/upgrade.sh full`
