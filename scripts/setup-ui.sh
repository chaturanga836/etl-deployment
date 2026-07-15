#!/usr/bin/env bash
# Start the DT Orch setup wizard UI (browser-based install — no manual .env editing)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALLER_PORT="${INSTALLER_PORT:-3000}"
INSTALLER_BIND="${INSTALLER_BIND:-0.0.0.0}"

if [[ ! -f config/license-public.pem || ! -f config/license-private.pem ]]; then
  # Optional: compose may still mount the public key; licensing itself is unused.
  python3 scripts/generate-license-keys.py --out-dir config >/dev/null 2>&1 || true
else
  python3 scripts/repair-license-keys.py --out-dir config >/dev/null 2>&1 || true
fi

_imds_token() {
  curl -fsS --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true
}

_public_ip() {
  curl -fsS --max-time 2 -H "X-aws-ec2-metadata-token: $(_imds_token)" \
    "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null \
    || curl -fsS --max-time 2 "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null \
    || true
}

_public_dns() {
  curl -fsS --max-time 2 -H "X-aws-ec2-metadata-token: $(_imds_token)" \
    "http://169.254.169.254/latest/meta-data/public-hostname" 2>/dev/null \
    || curl -fsS --max-time 2 "http://169.254.169.254/latest/meta-data/public-hostname" 2>/dev/null \
    || true
}

PUBLIC_IP="$(_public_ip)"
PUBLIC_DNS="$(_public_dns)"

# Prefer public IP — *.compute.internal is VPC-private and not reachable from browsers.
ACCESS_HOST="${PUBLIC_IP:-}"
if [[ -z "$ACCESS_HOST" && -n "$PUBLIC_DNS" && "$PUBLIC_DNS" != *".compute.internal"* ]]; then
  ACCESS_HOST="$PUBLIC_DNS"
fi
if [[ -z "$ACCESS_HOST" ]]; then
  ACCESS_HOST="$(hostname -f 2>/dev/null || hostname)"
fi

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
echo ""
echo "================================================================"
echo ""

export INSTALLER_PORT INSTALLER_BIND INSTALLER_PUBLIC_HOST="$ACCESS_HOST"
export ETL_DEPLOYMENT_HOST_ROOT="$ROOT_DIR"

INSTALLER_COMPOSE=(compose/installer.yml)
if [[ -f "$ROOT_DIR/../etl-back/Dockerfile" && -f "$ROOT_DIR/../elt-frontend/Dockerfile" ]]; then
  INSTALLER_COMPOSE+=(compose/installer.dev.yml)
  export INSTALLER_DEV_BUILD=true
  echo "Local source repos detected — wizard will build images from source instead of pulling from registry."
  echo ""
elif [[ -f "$ROOT_DIR/../etl-back/Dockerfile" ]]; then
  echo "NOTE: etl-back found but elt-frontend is missing — using public GHCR images."
  echo "      Clone elt-frontend next to etl-deployment only if you need a local frontend build."
  echo ""
else
  registry_url="$(grep -E '^[[:space:]]*url:' VERSION 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  registry_url="${registry_url:-ghcr.io/YOUR_GITHUB_ORG}"
  registry_public="$(grep -E '^[[:space:]]*public:' VERSION 2>/dev/null | head -1 | sed -E 's/.*(true|false).*/\1/')"
  registry_public="${registry_public:-true}"
  echo "  Images will be pulled from ${registry_url}."
  if [[ "$registry_public" == "true" ]]; then
    echo "  Public registry — customers do not need a GitHub token."
    echo "  Source code stays private; images ship compiled/protected builds."
    echo "  Vendor: run ./scripts/release/set-packages-public.sh if pulls are denied."
  else
    echo "  Private registry — customer logs in with their own GitHub PAT (read:packages)"
    echo "    after you grant package access. Not the vendor token."
  fi
  echo ""
fi

docker compose -f "${INSTALLER_COMPOSE[@]}" up --build "$@"
