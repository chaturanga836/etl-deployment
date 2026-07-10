#!/usr/bin/env bash
# Rebuild frontend from source using wizard .env URLs, then recreate the container.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

TAG="${FRONTEND_LOCAL_TAG:-dt-orch-frontend:install}"
STATE_DIR="${STATE_DIR:-}"
ENV_FILE_ARG=""
PUBLIC_HOST=""

usage() {
  cat <<'EOF'
Usage: rebuild-frontend-from-source.sh [OPTIONS]

Builds elt-frontend using NEXT_PUBLIC_KC_URL / NEXT_PUBLIC_API_URL from installer
.env (wizard renders the public host, e.g. http://YOUR_IP:8081).

Options:
  --env-file PATH     Use this .env (installer state or rendered deploy env)
  --public-host HOST  Public hostname/IP if .env is missing (e.g. 13.200.160.10)
  -h, --help          Show help

Updates FRONTEND_IMAGE and recreates dt-orch-frontend.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE_ARG="$2"; shift 2 ;;
    --public-host) PUBLIC_HOST="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ -n "$ENV_FILE_ARG" ]]; then
  export ENV_FILE="$ENV_FILE_ARG"
fi

env_file="$(frontend_install_resolve_env_file "$ROOT_DIR" "$STATE_DIR")"
if [[ -z "$env_file" ]]; then
  echo "No installer .env found — trying running stack / EC2 metadata ..."
  env_file="$(frontend_install_materialize_env_file "$ROOT_DIR" "$PUBLIC_HOST")" || {
    echo "ERROR: Could not locate or synthesize .env." >&2
    echo "Try: bash scripts/rebuild-frontend-from-source.sh --public-host YOUR_PUBLIC_IP" >&2
    echo "Or:  docker volume ls | grep installer" >&2
    exit 1
  }
  echo "Using generated env: $env_file"
fi

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"

frontend_install_patch_env_public_urls "$env_file" || true
frontend_install_build "$ROOT_DIR" "$env_file" "$TAG"
export ENV_FILE="$env_file"

echo "Recreating frontend..."
docker compose -f "$ROOT_DIR/compose/monolith.yml" --env-file "$env_file" --profile full up -d --force-recreate frontend

echo ""
echo "Hard-refresh the browser (Ctrl+Shift+R), then try login again."
echo "Keycloak should open at the public host from .env, not localhost."
