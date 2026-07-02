#!/usr/bin/env bash
# Hotfix dt-orch-api:v1.0.1 Cython + FastAPI Depends crash (TypeError: Expected str, got Depends).
# Safe to skip on v1.0.2+ images. Run from etl-deployment root on the host.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"

HOTFIX_DIR="$ROOT_DIR/scripts/hotfix"
ENV_FILE="${ENV_FILE:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

apply_hotfix() {
  local container="$1"
  for module in keycloak_auth workspace_database; do
    src="$HOTFIX_DIR/${module}.py"
    if [[ ! -f "$src" ]]; then
      echo "ERROR: missing hotfix file $src"
      exit 1
    fi
    docker cp "$src" "${container}:/app/core/${module}.py"
    docker exec "$container" sh -c "rm -f /app/core/${module}.cpython-*.so"
    echo "Patched core/${module}.py in ${container}"
  done
}

echo "Recreating api and worker..."
docker compose -f compose/monolith.yml --profile full --env-file "$ENV_FILE" up -d --force-recreate api worker

echo "Waiting for containers to start..."
sleep 10

apply_hotfix dt-orch-api
apply_hotfix dt-orch-worker

echo "Reloading API and worker to pick up hotfix..."
# supervisorctl is unavailable (no control socket in supervisord.conf); restart the
# containers instead — docker restart keeps copied files and relaunches uvicorn/celery.
docker restart dt-orch-api dt-orch-worker >/dev/null

# shellcheck disable=SC1091
set -a
source "$ENV_FILE"
set +a
HEALTH_URL="${HEALTH_URL:-http://localhost:${API_PORT:-8000}/health}"

echo "Waiting for API health at ${HEALTH_URL}..."
for _ in $(seq 1 24); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "API health OK"
    break
  fi
  sleep 5
done
if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "WARN: API health check failed — inspect: docker logs dt-orch-api --tail 50"
  exit 1
fi

echo "Auth hotfix applied."
