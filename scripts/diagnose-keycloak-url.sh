#!/usr/bin/env bash
# Print Keycloak / frontend URL config from the running install (run on the server via SSH).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

echo "=== DT Orch Keycloak URL diagnostics ==="
echo ""

env_file="$(frontend_install_resolve_env_file "$ROOT_DIR" "")"
if [[ -n "$env_file" && -f "$env_file" ]]; then
  echo "Installer .env: ${env_file}"
  for key in APP_URL NEXT_PUBLIC_KC_URL NEXT_PUBLIC_API_URL KEYCLOAK_PORT FRONTEND_IMAGE; do
    val="$(frontend_install_read_env "$key" "$env_file")"
    echo "  ${key}=${val:-<unset>}"
  done
  resolved="$(frontend_install_resolve_kc_url "$env_file")"
  echo "  resolved_build_kc_url=${resolved}"
else
  echo "WARN: No installer .env found."
fi

echo ""
if docker ps --format '{{.Names}}' | grep -qx 'dt-orch-frontend'; then
  echo "Frontend container env:"
  docker inspect dt-orch-frontend --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^(NEXT_PUBLIC_KC_URL|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_KC_REALM)=' || true
  image="$(docker inspect dt-orch-frontend --format '{{.Config.Image}}')"
  echo "  image=${image}"
else
  echo "WARN: dt-orch-frontend container is not running."
fi

echo ""
public_host=""
if [[ -n "${env_file:-}" && -f "${env_file:-}" ]]; then
  public_host="$(frontend_install_read_env APP_URL "$env_file" | sed -E 's#https?://([^/:]+).*#\1#')"
fi
public_host="${public_host:-localhost}"

echo "Reachability checks:"
for path in "/realms/workspace-realm" "/login"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://${public_host}${path}" || echo '000')"
  echo "  http://${public_host}${path} -> HTTP ${code}"
done

echo ""
echo "Browser checks (on your laptop):"
echo "  1. Open http://${public_host}/login?kc_debug=1"
echo "  2. Press F12 -> Console, filter: KC-DEBUG"
echo "  3. Click Continue with Keycloak — auth URL must use ${public_host}, not localhost"
echo ""
echo "If NEXT_PUBLIC_KC_URL shows localhost, rebuild frontend:"
echo "  bash scripts/rebuild-frontend-from-source.sh --public-host ${public_host}"
