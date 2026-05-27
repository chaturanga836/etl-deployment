# ELT Engine — Self-hosted Deployment

Orchestration repo for the full ELT Engine stack. This repo contains **no application code** — it wires together the sibling repositories via Docker Compose.

| Repo | Role |
|------|------|
| [etl-back](https://github.com/chaturanga836/etl-back) | FastAPI API + Celery worker |
| [elt-frontend](https://github.com/chaturanga836/elt-frontend) | Next.js UI |
| [trino-keyclock](https://github.com/chaturanga836/trino-keyclock) | Keycloak reference (service inlined here) |
| **etl-deployment** (this repo) | Compose, nginx, install scripts |

## Prerequisites

- Docker and Docker Compose v2
- All application repos cloned as **siblings** under the same parent directory:

```
python/
  etl-back/
  elt-frontend/
  trino-keyclock/
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

`POSTGRES_DB=postgres` in compose is only the Postgres bootstrap catalog — not application data.

## Compose profiles

| Profile | Services | Use case |
|---------|----------|----------|
| `full` | postgres, redis, api, worker, keycloak, frontend, nginx | Single-server install |
| `backend` | postgres, redis, api, worker | API + worker on one host |
| `frontend` | frontend only | UI on a separate host |
| `auth` | postgres, keycloak | Centralized identity provider |

```bash
# Backend only
docker compose --profile backend up -d --build

# Frontend only (set NEXT_PUBLIC_API_URL to remote API first)
docker compose --profile frontend up -d --build

# Keycloak only
docker compose --profile auth up -d
```

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

## Production checklist

- [ ] Change all default passwords in `.env`
- [ ] Switch Keycloak from `start-dev` to `start` with proper hostname/TLS (edit `docker-compose.yml`)
- [ ] Put TLS termination in front of nginx (Caddy, Traefik, or cloud load balancer)
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
