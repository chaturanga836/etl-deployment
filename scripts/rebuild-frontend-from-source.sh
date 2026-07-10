#!/usr/bin/env bash
# Build frontend from elt-frontend source (fixes localhost Keycloak redirect on customer hosts).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELT_FRONTEND="${ELT_FRONTEND:-$ROOT_DIR/../elt-frontend}"
ELT_FRONTEND_REPO_HTTPS="${ELT_FRONTEND_REPO_HTTPS:-https://github.com/chaturanga836/elt-frontend.git}"
TAG="${FRONTEND_LOCAL_TAG:-dt-orch-frontend:fixed}"
STATE_DIR="${STATE_DIR:-}"

resolve_env_file() {
  if [[ -n "$STATE_DIR" && -f "${STATE_DIR}/.env" ]]; then
    echo "${STATE_DIR}/.env"
    return
  fi
  local vol
  vol=$(docker volume inspect etl-deployment_installer_state --format '{{ .Mountpoint }}' 2>/dev/null || true)
  if [[ -n "$vol" && -f "$vol/.env" ]]; then
    echo "$vol/.env"
    return
  fi
  if [[ -f "$ROOT_DIR/.env" ]]; then
    echo "$ROOT_DIR/.env"
    return
  fi
  echo ""
}

ensure_frontend_checkout() {
  if [[ -f "$ELT_FRONTEND/Dockerfile" ]]; then
    return 0
  fi
  echo "Cloning elt-frontend into $ELT_FRONTEND ..."
  mkdir -p "$(dirname "$ELT_FRONTEND")"
  git clone "$ELT_FRONTEND_REPO_HTTPS" "$ELT_FRONTEND"
}

usage() {
  cat <<'EOF'
Usage: rebuild-frontend-from-source.sh

Builds elt-frontend with localhost NEXT_PUBLIC_* defaults; runtime code rewrites
localhost → the browser hostname (e.g. 13.200.160.10:8081 for Keycloak).

Requires elt-frontend at ../elt-frontend (cloned automatically if missing).
Updates installer state .env FRONTEND_IMAGE and recreates dt-orch-frontend.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_frontend_checkout

echo "Building frontend from $ELT_FRONTEND as $TAG ..."
docker build -t "$TAG" "$ELT_FRONTEND" \
  --build-arg "NEXT_PUBLIC_API_URL=http://localhost/api/v1" \
  --build-arg "NEXT_PUBLIC_BUILD_ID=local-fix" \
  --build-arg "NEXT_PUBLIC_KC_URL=http://localhost:8081" \
  --build-arg "NEXT_PUBLIC_KC_REALM=workspace-realm" \
  --build-arg "NEXT_PUBLIC_KC_CLIENT_ID=workspace-web"

env_file="$(resolve_env_file)"
if [[ -z "$env_file" ]]; then
  echo "WARN: No .env found — set FRONTEND_IMAGE=$TAG manually and recreate frontend." >&2
  exit 0
fi

if grep -q '^FRONTEND_IMAGE=' "$env_file"; then
  sed -i.bak "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=${TAG}|" "$env_file"
else
  echo "FRONTEND_IMAGE=${TAG}" >> "$env_file"
fi
rm -f "${env_file}.bak"
echo "Updated FRONTEND_IMAGE in $env_file"

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
export ENV_FILE="$env_file"

echo "Recreating frontend..."
docker compose -f "$ROOT_DIR/compose/monolith.yml" --env-file "$env_file" --profile full up -d --force-recreate frontend

echo ""
echo "Hard-refresh the browser (Ctrl+Shift+R), then try login again."
echo "Keycloak URL should use your server IP, not localhost:8081."
