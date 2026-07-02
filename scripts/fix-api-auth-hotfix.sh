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

for module in keycloak_auth workspace_database; do
  src="$HOTFIX_DIR/${module}.py"
  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing hotfix file $src"
    exit 1
  fi
  docker cp "$src" "dt-orch-api:/app/core/${module}.py"
  docker exec dt-orch-api sh -c "rm -f /app/core/${module}.cpython-*.so"
  echo "Patched core/${module}.py in dt-orch-api"
done

echo "Recreating api and worker..."
docker compose -f compose/monolith.yml --profile full --env-file "$ENV_FILE" up -d --force-recreate api worker

echo "Waiting for API..."
sleep 30
if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
  echo "API health OK"
else
  echo "WARN: API health check failed — inspect: docker logs dt-orch-api --tail 30"
  exit 1
fi

echo "Auth hotfix applied."
