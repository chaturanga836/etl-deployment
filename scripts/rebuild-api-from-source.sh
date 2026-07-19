#!/usr/bin/env bash
# Build a fixed API image from sibling etl-back (avoids broken v1.0.1 GHCR Cython build).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ETL_BACK="${ETL_BACK:-$ROOT_DIR/../etl-back}"
TAG="${API_LOCAL_TAG:-dt-orch-api:fixed}"
STATE_DIR="${STATE_DIR:-/opt/etl-deployment-state}"

usage() {
  cat <<'EOF'
Usage: rebuild-api-from-source.sh

Builds etl-back with SOURCE_PROTECTION=1 using current release_keep_py rules
(keycloak_auth and FastAPI Depends modules stay as pure Python).

Requires etl-back checkout at ../etl-back (or set ETL_BACK).

After build, updates STATE_DIR/.env API_IMAGE and recreates api + worker.
EOF
}

if [[ ! -f "$ETL_BACK/Dockerfile" ]]; then
  echo "ERROR: etl-back not found at $ETL_BACK"
  echo "Clone it: git clone <etl-back-url> $ETL_BACK"
  exit 1
fi

echo "Building API image from $ETL_BACK as $TAG ..."
docker build --build-arg SOURCE_PROTECTION=1 -t "$TAG" "$ETL_BACK"

env_file="$STATE_DIR/.env"
if [[ ! -f "$env_file" ]]; then
  vol=$(docker volume inspect etl-deployment_installer_state --format '{{ .Mountpoint }}' 2>/dev/null || true)
  if [[ -n "$vol" && -f "$vol/.env" ]]; then
    env_file="$vol/.env"
  fi
fi

if [[ -f "$env_file" ]]; then
  if grep -q '^API_IMAGE=' "$env_file"; then
    sed -i.bak "s|^API_IMAGE=.*|API_IMAGE=${TAG}|" "$env_file"
  else
    echo "API_IMAGE=${TAG}" >> "$env_file"
  fi
  rm -f "${env_file}.bak"
  echo "Updated API_IMAGE in $env_file"
fi

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
export ENV_FILE="$env_file"

echo "Recreating api and worker..."
docker compose -f "$ROOT_DIR/compose/monolith.yml" --env-file "$env_file" --profile full up -d --force-recreate api worker

# Studio project DBs are schemas on shared SQL — remove leftover per-workspace containers.
echo "Removing leftover per-workspace Postgres containers (ws-*-postgres-db)..."
for c in $(docker ps -aq 2>/dev/null); do
  name="$(docker inspect -f '{{.Name}}' "$c" 2>/dev/null | sed 's#^/##')"
  if [[ "$name" =~ ^ws-[0-9]+-postgres-db$ ]]; then
    echo "Removing $name"
    docker rm -f "$c" || true
  fi
done

echo ""
echo "API rebuilt with shared-schema Studio databases (no ws-*-postgres-db)."
echo "Watch: docker logs -f dt-orch-api"
echo "Health: curl -sf http://localhost/health && echo PASS"
