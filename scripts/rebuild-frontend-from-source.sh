#!/usr/bin/env bash
# Rebuild frontend from source using wizard .env URLs, then recreate the container.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

TAG="${FRONTEND_LOCAL_TAG:-dt-orch-frontend:install}"
STATE_DIR="${STATE_DIR:-}"

usage() {
  cat <<'EOF'
Usage: rebuild-frontend-from-source.sh

Builds elt-frontend using NEXT_PUBLIC_KC_URL / NEXT_PUBLIC_API_URL from installer
.env (wizard renders the public host, e.g. http://13.200.160.10:8081).

Updates FRONTEND_IMAGE and recreates dt-orch-frontend.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

env_file="$(frontend_install_resolve_env_file "$ROOT_DIR" "$STATE_DIR")"
if [[ -z "$env_file" ]]; then
  echo "ERROR: No installer .env found. Complete the wizard install first." >&2
  exit 1
fi

frontend_install_build "$ROOT_DIR" "$env_file" "$TAG"

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
export ENV_FILE="$env_file"

echo "Recreating frontend..."
docker compose -f "$ROOT_DIR/compose/monolith.yml" --env-file "$env_file" --profile full up -d --force-recreate frontend

echo ""
echo "Hard-refresh the browser (Ctrl+Shift+R), then try login again."
echo "Keycloak should open at the public host from .env, not localhost."
