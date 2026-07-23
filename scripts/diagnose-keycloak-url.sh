#!/usr/bin/env bash
# Print Keycloak / frontend URL config from the running install (run on the server via SSH).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

_imds_token() {
  curl -fsS --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true
}

_detect_public_host() {
  local ip dns
  ip="$(curl -fsS --max-time 2 -H "X-aws-ec2-metadata-token: $(_imds_token)" \
    "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null \
    || curl -fsS --max-time 2 "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null \
    || true)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return
  fi
  dns="$(curl -fsS --max-time 2 -H "X-aws-ec2-metadata-token: $(_imds_token)" \
    "http://169.254.169.254/latest/meta-data/public-hostname" 2>/dev/null || true)"
  if [[ -n "$dns" && "$dns" != *".compute.internal"* ]]; then
    echo "$dns"
    return
  fi
  echo "localhost"
}

echo "=== DT Orch Keycloak URL diagnostics ==="
echo ""

wizard_running=false
if docker ps --format '{{.Names}}' | grep -qx 'dt-orch-installer'; then
  wizard_running=true
fi

env_file="$(frontend_install_resolve_env_file "$ROOT_DIR" "")"
public_host=""
if [[ -n "${env_file:-}" && -f "${env_file:-}" ]]; then
  public_host="$(frontend_install_read_env APP_URL "$env_file" | sed -E 's#https?://([^/:]+).*#\1#')"
fi
public_host="${public_host:-$(_detect_public_host)}"

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
  if [[ "$wizard_running" == true ]]; then
    echo ""
    echo "  The setup wizard is running but Install has NOT completed yet."
    echo "  This is normal right after fresh-install.sh — finish the wizard first:"
    public_ip="$(_detect_public_host)"
    echo "    http://${public_ip}:3000  →  complete all steps  →  click Install"
    echo ""
    echo "  Re-run this script AFTER install finishes."
  fi
fi

echo ""
if docker ps --format '{{.Names}}' | grep -qx 'dt-orch-frontend'; then
  echo "Frontend container env:"
  docker inspect dt-orch-frontend --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^(NEXT_PUBLIC_KC_URL|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_KC_REALM)=' || true
  image="$(docker inspect dt-orch-frontend --format '{{.Config.Image}}')"
  echo "  image=${image}"
  if [[ "$image" == ghcr.io/* ]]; then
    echo ""
    echo "  PROBLEM: Registry frontend image — ships with NEXT_PUBLIC_KC_URL=http://localhost:8081."
    echo "  FIX: bash scripts/rebuild-frontend-from-source.sh --public-host ${public_host}"
  fi
else
  echo "WARN: dt-orch-frontend container is not running."
  if [[ "$wizard_running" == true && -z "${env_file:-}" ]]; then
    echo "  (Expected until you complete Install in the wizard UI.)"
  fi
fi

echo ""
echo "Reachability checks (host=${public_host}):"
for path in "/realms/workspace-realm" "/login"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://${public_host}${path}" 2>/dev/null || echo '000')"
  echo "  http://${public_host}${path} -> HTTP ${code}"
done

echo ""
if grep -q 'frontend_install_patch_env_public_urls' "${ROOT_DIR}/scripts/install.sh" 2>/dev/null; then
  echo "Install script: Keycloak URL patch present (good)."
else
  echo "WARN: Install script missing Keycloak URL patch — git pull etl-deployment."
fi

echo ""
echo "After install, verify in browser:"
echo "  1. Open http://${public_host}/login?kc_debug=1"
echo "  2. F12 -> Console, filter: KC-DEBUG"
echo "  3. resolvedBaseUrl must be http://${public_host} (NOT localhost:8081)"
echo ""
if [[ -n "${env_file:-}" && -f "${env_file:-}" ]]; then
  kc_val="$(frontend_install_read_env NEXT_PUBLIC_KC_URL "$env_file")"
  if [[ "$kc_val" == *localhost* || "$kc_val" == *127.0.0.1* ]]; then
    echo "FIX: .env still has localhost Keycloak URL. Rebuild frontend:"
    echo "  bash scripts/rebuild-frontend-from-source.sh --public-host ${public_host}"
  fi
fi
