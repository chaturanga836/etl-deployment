#!/usr/bin/env bash
# DEVELOPER ONLY — build API from a local etl-back checkout.
# Production / customer hosts must NOT clone app repos. Use:
#   bash scripts/upgrade.sh full
# after a platform release publishes new GHCR images.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ETL_BACK="${ETL_BACK:-$ROOT_DIR/../etl-back}"
TAG="${API_LOCAL_TAG:-dt-orch-api:fixed}"
STATE_DIR="${STATE_DIR:-/opt/etl-deployment-state}"

usage() {
  cat <<'EOF'
Usage: rebuild-api-from-source.sh

DEVELOPER ONLY. Builds etl-back from a sibling checkout and retags the
local API image. Not for production install hosts.

On a customer / EC2 host (etl-deployment only), upgrade from GHCR instead:

  cd ~/etl-deployment
  git pull
  bash scripts/upgrade.sh full

Requires etl-back at ../etl-back (or set ETL_BACK) on a build machine.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$ETL_BACK/Dockerfile" ]]; then
  echo "ERROR: This script builds from local source and needs etl-back at:"
  echo "  $ETL_BACK"
  echo ""
  echo "On a production host you should not clone etl-back."
  echo "Pull published images instead:"
  echo "  bash $ROOT_DIR/scripts/upgrade.sh full"
  echo ""
  echo "To publish a new API image, run a platform release from CI / a"
  echo "dev machine that already has the app repos, then upgrade on this host."
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

# Prefer shared SQL for any leftover infra create_database calls.
if [[ -f "$env_file" ]]; then
  if grep -q '^PROVISION_MODE=' "$env_file"; then
    sed -i.bak "s|^PROVISION_MODE=.*|PROVISION_MODE=local|" "$env_file"
  else
    echo "PROVISION_MODE=local" >> "$env_file"
  fi
  rm -f "${env_file}.bak"
fi

echo "Recreating api, worker, and infra-service..."
docker compose -f "$ROOT_DIR/compose/monolith.yml" --env-file "$env_file" --profile full up -d --force-recreate api worker infra-service

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
echo "Local API image applied. For production, prefer: bash scripts/upgrade.sh full"
echo "Watch: docker logs -f dt-orch-api"
echo "Health: curl -sf http://localhost/health && echo PASS"
