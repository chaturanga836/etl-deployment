# Releasing DT Orch container images

Images are published to **GitHub Container Registry (GHCR)** on git tag push (`v*.*.*`).

| Image | Source repo | Dockerfile |
|-------|-------------|------------|
| `dt-orch-api` | `etl-back` | `Dockerfile` |
| `dt-orch-frontend` | `elt-frontend` | `Dockerfile` |
| `baas-infra` | `platform-infra-repo` | `infra-service/Dockerfile` |
| `dt-orch-scraper` | `etl-deployment` | `scraper-service/Dockerfile` |

## One-time setup (GitHub)

1. **Package visibility** — After first push, set packages to public or grant customer read access under org settings.
2. **Frontend build URLs (optional)** — In `elt-frontend` repo → Settings → Secrets and variables → Actions → Variables:
   - `NEXT_PUBLIC_API_URL` (e.g. `https://studio.example.com/api/v1`)
   - `NEXT_PUBLIC_KC_URL`
   - `NEXT_PUBLIC_KC_REALM` (default `workspace-realm`)
   - `NEXT_PUBLIC_KC_CLIENT_ID` (default `workspace-web`)

If unset, release builds use localhost defaults (fine for dev; set vars for production UI builds).

## Release a version

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

Login before pull (private packages):

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

## Manual push (no GitHub Actions)

```bash
export REGISTRY=ghcr.io/your-org
export VERSION=v1.0.0
./scripts/release/build-and-push.sh all
```

Run from `etl-deployment` with sibling repos checked out.

## After release

1. Update [VERSION](VERSION) `platform:` and `registry.url` if needed.
2. Customer upgrade: `./scripts/upgrade.sh full`
