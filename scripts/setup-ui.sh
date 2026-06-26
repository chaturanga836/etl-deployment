#!/usr/bin/env bash
# Start the DT Orch setup wizard UI (browser-based install — no manual .env editing)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALLER_PORT="${INSTALLER_PORT:-9080}"
INSTALLER_BIND="${INSTALLER_BIND:-0.0.0.0}"

if [[ ! -f config/license-public.pem ]]; then
  echo "Generating license key pair (enables 3-month trial licenses)..."
  python3 scripts/generate-license-keys.py --out-dir config
fi

_public_ip() {
  curl -fsS --max-time 2 "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true
}

_public_dns() {
  curl -fsS --max-time 2 "http://169.254.169.254/latest/meta-data/public-hostname" 2>/dev/null || true
}

PUBLIC_DNS="$(_public_dns)"
PUBLIC_IP="$(_public_ip)"
ACCESS_HOST="${PUBLIC_DNS:-${PUBLIC_IP:-$(hostname -f 2>/dev/null || hostname)}}"

echo ""
echo "================================================================"
echo "  DT Orch Setup Wizard"
echo "================================================================"
echo ""
echo "  Open in your browser:"
echo "    http://${ACCESS_HOST}:${INSTALLER_PORT}"
echo ""
if [[ -n "$PUBLIC_IP" || -n "$PUBLIC_DNS" ]]; then
  echo "  EC2 security group: allow inbound TCP ${INSTALLER_PORT} (wizard)"
  echo "                        and TCP 80 (platform after install)"
  echo ""
fi
echo "  All configuration is done in the wizard — no manual .env editing."
echo "  Without a license key, a 3-month trial is applied automatically."
echo ""
echo "================================================================"
echo ""

export INSTALLER_PORT INSTALLER_BIND
docker compose -f compose/installer.yml up --build "$@"
