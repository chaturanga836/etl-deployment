#!/usr/bin/env bash
# Pull new images and recreate containers for a platform upgrade.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${1:-full}"
ROLE="${ROLE:-}"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run install.sh first."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
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
docker compose "${compose_args[@]}" --env-file .env pull || true

echo "Recreating services..."
# shellcheck disable=SC2086
docker compose "${compose_args[@]}" --profile "$PROFILE" --env-file .env up -d --force-recreate

"${ROOT_DIR}/scripts/health-check.sh"

echo "Upgrade complete."
