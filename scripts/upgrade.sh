#!/usr/bin/env bash
# Pull new images and recreate containers for a platform upgrade.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"

PROFILE="${1:-full}"
ROLE="${ROLE:-}"
STATE_DIR="${STATE_DIR:-}"

if git rev-parse --git-dir >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "Updating deployment manifest (git pull --ff-only origin ${branch})..."
  git pull --ff-only origin "$branch" || echo "WARN: git pull failed; using local VERSION"
fi

env_file=".env"
if [[ -n "$STATE_DIR" && -f "${STATE_DIR}/.env" ]]; then
  env_file="${STATE_DIR}/.env"
fi

if [[ ! -f "$env_file" ]]; then
  echo "ERROR: .env not found at ${env_file}. Run install.sh first."
  exit 1
fi

bash "${ROOT_DIR}/scripts/release/sync-env-from-version.sh" "$env_file" "${ROOT_DIR}/VERSION"

# shellcheck disable=SC1091
set -a
source "$env_file"
set +a

NEW_TAG="${IMAGE_TAG:-v1.0.0}"
echo "Upgrading to image tag: ${NEW_TAG}"

compose_args=(-f compose/monolith.yml)
if [[ -f compose/docker-compose.dev.yml ]] && [[ "${ELT_DEV_BUILD:-false}" == "true" ]]; then
  compose_args+=(-f compose/docker-compose.dev.yml)
fi

if [[ -n "$ROLE" ]]; then
  case "$ROLE" in
    api) compose_args=(-f compose/roles/api.yml) ;;
    worker) compose_args=(-f compose/roles/worker.yml) ;;
    frontend) compose_args=(-f compose/roles/frontend.yml) ;;
    infra) compose_args=(-f compose/roles/infra.yml) ;;
  esac
fi

echo "Pulling images..."
# shellcheck disable=SC2086
docker compose "${compose_args[@]}" --env-file "$env_file" pull || true

echo "Recreating services..."
# shellcheck disable=SC2086
docker compose "${compose_args[@]}" --profile "$PROFILE" --env-file "$env_file" up -d --force-recreate

ENV_FILE="$env_file" "${ROOT_DIR}/scripts/health-check.sh"

echo "Upgrade complete."
