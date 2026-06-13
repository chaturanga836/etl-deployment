# ELT Engine — Self-hosted Deployment

Orchestration repo for the full ELT Engine stack. This repo contains **no application code** — it wires together the sibling repositories via Docker Compose.

| Repo | Role |
|------|------|
| [etl-back](https://github.com/chaturanga836/etl-back) | FastAPI API + Celery worker |
| [elt-frontend](https://github.com/chaturanga836/elt-frontend) | Next.js UI |
| [trino-keyclock](https://github.com/chaturanga836/trino-keyclock) | Keycloak reference (service inlined here) |
| **etl-deployment** (this repo) | Runtime bundle, compose templates, renderer |
| [elt-installer](../elt-installer) | **Customer-facing setup wizard** (control plane) |
| [Ai-Agent-framework](../Ai-Agent-framework) | LlamaIndex workflow agent microservice (optional) |

Optional **Ollama** (local LLM): see [`docs/OLLAMA.md`](docs/OLLAMA.md). Service is defined in this repo’s `docker-compose.yml` (profile `ollama`).

## Recommended install path

**Customers** should use the [elt-installer](../elt-installer) web wizard — not raw Docker Compose.

This repo is the **runtime engine** the installer generates config for:

1. User completes wizard in `elt-installer`
2. Control plane renders `.env` via [`renderer/render.py`](renderer/render.py)
3. Artifacts land in `generated/{job_id}/`
4. Docker Compose here starts the product stack

Operators and developers can still use compose directly (below).

## Prerequisites

- Docker and Docker Compose v2
- All application repos cloned as **siblings** under the same parent directory:

```
python/
  etl-back/
  elt-frontend/
  trino-keyclock/
  Ai-Agent-framework/   ← optional agent service
  etl-deployment/    ← you are here
```

## Quick start (full stack)

```bash
cd etl-deployment
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and KC_ADMIN_PASSWORD

docker compose --profile full up -d --build
# or
bash scripts/install.sh full
```

Open [http://localhost](http://localhost) — nginx routes:

| Path | Service |
|------|---------|
| `/` | Next.js frontend |
| `/api/` | FastAPI backend |
| `/health` | API health check |

Keycloak admin console: [http://localhost:8081](http://localhost:8081) (default admin from `.env`).

Database migrations run automatically when the API container starts (`alembic upgrade head` in the backend entrypoint).

### Databases

On first startup, Postgres runs [`scripts/init-db.sql`](scripts/init-db.sql) and creates both application databases:

| Database | Used by |
|----------|---------|
| `elt_metadata` | Backend (pipelines, tasks, connections) |
| `keycloak` | Keycloak identity provider |
| `elt_agent` | Agent microservice (job metadata) |

`POSTGRES_DB=postgres` in compose is only the Postgres bootstrap catalog — not application data.

## Template renderer

Convert a deployment JSON (from the installer wizard) into `.env`:

```bash
python renderer/render.py \
  --config schema/examples/monolith-bundled.json \
  --out ./generated/example

cp generated/example/.env .env
docker compose --profile full up -d --build
```

Schema: [`schema/deployment.schema.json`](schema/deployment.schema.json)

## Compose profiles

| Profile | Services | Use case |
|---------|----------|----------|
| `full` | postgres, redis, api, worker, agent-api, keycloak, frontend, nginx | Single-server install |
| `backend` | postgres, redis, api, worker, agent-api | API + worker on one host |
| `agent` | agent-api only (with `backend` or `full` postgres/api) | Agent service only |
| `frontend` | frontend only | UI on a separate host |
| `auth` | postgres, keycloak | Centralized identity provider |
| `ollama` | ollama (local LLM) | Optional; combine with `full` or `backend` on RAM-heavy hosts |

```bash
# Backend only
docker compose --profile backend up -d --build

# Full stack + Ollama (16 GB+ RAM recommended)
docker compose --profile full --profile ollama up -d --build
docker exec elt-ollama ollama pull llama3.2

# Frontend only (set NEXT_PUBLIC_API_URL to remote API first)
docker compose --profile frontend up -d --build

# Keycloak only
docker compose --profile auth up -d
```

Workspace **AI & Agent** settings when using Ollama: provider `ollama`, model `llama3.2`, API key any non-empty string, base URL `http://ollama:11434/v1`.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Important variables:

| Variable | Description |
|----------|-------------|
| `APP_URL` | Public browser URL (used by install script health check) |
| `NEXT_PUBLIC_API_URL` | Baked into frontend at **build time** — must match how browsers reach the API |
| `DATABASE_URL` | PostgreSQL connection for backend metadata |
| `KC_SERVER_URL` | Keycloak URL as seen by backend containers |
| `KEYCLOAK_TOKEN_URL` | OAuth token endpoint for backend service auth |
| `KC_DEV_REALM` | Keycloak realm name for JWT validation |

### Split deployment

When frontend and backend run on different servers:

1. **Server A** — `docker compose --profile backend up -d --build`
2. **Server B** — set `NEXT_PUBLIC_API_URL=http://server-a/api/v1`, then `docker compose --profile frontend up -d --build`
3. **Server C (optional)** — `docker compose --profile auth up -d` for centralized Keycloak

Update `KC_SERVER_URL` and `KEYCLOAK_TOKEN_URL` in backend `.env` to point at the Keycloak host.

### CORS note

When using the `full` profile with nginx, the browser talks to one origin (`APP_URL`) for both UI and API — no CORS issues.

When exposing ports 3000 and 8000 directly (without nginx), ensure the backend CORS settings in `etl-back/main.py` include your frontend origin.

## TLS (Let's Encrypt)

The `full` profile nginx proxy supports HTTPS via Certbot webroot. HTTP stays available for certificate renewal and redirects to HTTPS once a cert is installed.

**On your EC2 host** (replace with your domain):

```bash
# 1. DNS: A records for dtorch.online and www.dtorch.online -> your Elastic IP
# 2. Security group: allow TCP 80 and 443
# 3. Start the stack
docker compose --profile full up -d --build

# 4. Obtain certificate and enable HTTPS
sudo bash scripts/setup-tls.sh dtorch.online www.dtorch.online

# 5. Point the app at HTTPS (edit .env), then rebuild frontend
#    APP_URL=https://dtorch.online
#    NEXT_PUBLIC_API_URL=https://dtorch.online/api/v1
docker compose --profile full up -d --build frontend
```

How it works:

| Path | Purpose |
|------|---------|
| `/.well-known/acme-challenge/` | Served from `/var/www/letsencrypt` for Certbot |
| `/etc/letsencrypt/live/current/` | Symlink to the active cert (created by `setup-tls.sh`) |
| `nginx/ssl.conf` | Generated inside the container when certs exist |

Renewal is automatic via Certbot's deploy hook (`docker exec elt-proxy nginx -s reload`).

Do **not** use `certbot --nginx` — port 80 is owned by the Docker proxy, not host nginx.

## Production checklist

- [ ] Change all default passwords in `.env`
- [ ] Run `scripts/setup-tls.sh` and set `APP_URL` / `NEXT_PUBLIC_API_URL` to `https://...`
- [ ] Switch Keycloak from `start-dev` to `start` with proper hostname/TLS (edit `docker-compose.yml`)
- [ ] Configure Keycloak realm `etl-dev` (or update `KC_DEV_REALM`)
- [ ] Set up `KC_ADMIN_CLIENT_SECRET` for tenant provisioning API
- [ ] Use pre-built images from a registry instead of local `build:` (future CI step)

## Troubleshooting

```bash
# View logs
docker compose --profile full logs -f

# Rebuild a single service
docker compose --profile full up -d --build api

# Reset database (destroys data)
docker compose --profile full down -v
```

## Related repos

- Backend: https://github.com/chaturanga836/etl-back
- Frontend: https://github.com/chaturanga836/elt-frontend
- Keycloak: https://github.com/chaturanga836/trino-keyclock

## License

MIT
