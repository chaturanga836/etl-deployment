#!/usr/bin/env bash
# Pull new images and recreate containers for a platform upgrade.
# Customer hosts: etl-deployment only — no app-repo clones.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"

PROFILE="${1:-full}"
ROLE="${ROLE:-}"
STATE_DIR="${STATE_DIR:-}"

usage() {
  cat <<'EOF'
Usage: upgrade.sh [PROFILE]

Pull GHCR images pinned in VERSION and recreate the platform stack.
Default PROFILE is "full".

Resolves installer .env from (in order):
  ENV_FILE, STATE_DIR, installer_state volume, /opt/etl-deployment-state, repo .env

If .env is missing, empty, or incomplete, recovers automatically from the
running dt-orch-api container or installer deployment.json, then syncs image
pins from VERSION.

Examples:
  bash scripts/upgrade.sh full
  STATE_DIR=/opt/etl-deployment-state bash scripts/upgrade.sh full
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if git rev-parse --git-dir >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "Updating deployment manifest (git pull --ff-only origin ${branch})..."
  git pull --ff-only origin "$branch" || echo "WARN: git pull failed; using local VERSION"
fi

if ! env_file="$(frontend_install_ensure_env_file "$ROOT_DIR" "$STATE_DIR")"; then
  exit 1
fi

# Compose interpolates env_file: ${ENV_FILE} relative to the compose file dir
# (compose/). Relative paths like ".env" wrongly become compose/.env.
if [[ "$env_file" != /* ]]; then
  env_file="${ROOT_DIR}/${env_file}"
fi
env_file="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"

echo "Using env file: $env_file"
bash "${ROOT_DIR}/scripts/release/sync-env-from-version.sh" "$env_file" "${ROOT_DIR}/VERSION"

# Bind mounts in monolith.yml require this; keep it in the env file so
# `docker compose --env-file` works without a separate export.
if grep -q '^ETL_DEPLOYMENT_HOST_ROOT=' "$env_file"; then
  sed -i.bak "s|^ETL_DEPLOYMENT_HOST_ROOT=.*|ETL_DEPLOYMENT_HOST_ROOT=${ETL_DEPLOYMENT_HOST_ROOT}|" "$env_file"
else
  echo "ETL_DEPLOYMENT_HOST_ROOT=${ETL_DEPLOYMENT_HOST_ROOT}" >> "$env_file"
fi
rm -f "${env_file}.bak"

frontend_install_repair_env_file_for_shell "$env_file"

export ENV_FILE="$env_file"

# shellcheck disable=SC1091
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

NEW_TAG="${IMAGE_TAG:-v1.0.0}"
echo "Upgrading to image tag: ${NEW_TAG}"

compose_args=(-f "${ROOT_DIR}/compose/monolith.yml")
if [[ -f "${ROOT_DIR}/compose/docker-compose.dev.yml" ]] && [[ "${ELT_DEV_BUILD:-false}" == "true" ]]; then
  compose_args+=(-f "${ROOT_DIR}/compose/docker-compose.dev.yml")
fi

if [[ -n "$ROLE" ]]; then
  case "$ROLE" in
    api) compose_args=(-f "${ROOT_DIR}/compose/roles/api.yml") ;;
    worker) compose_args=(-f "${ROOT_DIR}/compose/roles/worker.yml") ;;
    frontend) compose_args=(-f "${ROOT_DIR}/compose/roles/frontend.yml") ;;
    infra) compose_args=(-f "${ROOT_DIR}/compose/roles/infra.yml") ;;
  esac
fi

echo "Pulling images..."
docker compose "${compose_args[@]}" --env-file "$env_file" pull || true

echo "Recreating services..."
docker compose "${compose_args[@]}" --profile "$PROFILE" --env-file "$env_file" up -d --force-recreate

# Leftover per-workspace Postgres containers must not remain after shared-SQL upgrades.
echo "Removing leftover per-workspace Postgres containers (ws-*-postgres-db)..."
for c in $(docker ps -aq 2>/dev/null); do
  name="$(docker inspect -f '{{.Name}}' "$c" 2>/dev/null | sed 's#^/##')"
  if [[ "$name" =~ ^ws-[0-9]+-postgres-db$ ]]; then
    echo "Removing $name"
    docker rm -f "$c" || true
  fi
done

ENV_FILE="$env_file" bash "${ROOT_DIR}/scripts/health-check.sh"

echo "Upgrade complete."
