#!/usr/bin/env bash
# Obtain a Let's Encrypt certificate and enable HTTPS on the elt-proxy container.
#
# Usage (on the EC2 host, from etl-deployment/):
#   sudo bash scripts/setup-tls.sh dtorch.online
#   sudo bash scripts/setup-tls.sh dtorch.online www.dtorch.online
#
# Prerequisites:
#   - DNS A records for all domains point to this server's public IP
#   - EC2 security group allows inbound TCP 80 and 443
#   - docker compose --profile full is running (proxy on port 80)

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: sudo bash scripts/setup-tls.sh <domain> [extra-domain ...]" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

PRIMARY_DOMAIN="$1"
shift
EXTRA_DOMAINS=("$@")
WEBROOT=/var/www/letsencrypt
LE_LIVE=/etc/letsencrypt/live

mkdir -p "$WEBROOT"
chown -R www-data:www-data "$WEBROOT"

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y certbot
fi

CERTBOT_ARGS=(-d "$PRIMARY_DOMAIN")
for domain in "${EXTRA_DOMAINS[@]}"; do
  CERTBOT_ARGS+=(-d "$domain")
done

echo "Requesting certificate for: ${PRIMARY_DOMAIN} ${EXTRA_DOMAINS[*]}"

certbot certonly --webroot \
  -w "$WEBROOT" \
  "${CERTBOT_ARGS[@]}" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email

ln -sfn "${LE_LIVE}/${PRIMARY_DOMAIN}" "${LE_LIVE}/current"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR=/etc/letsencrypt/renewal-hooks/deploy
mkdir -p "$HOOK_DIR"
cat >"${HOOK_DIR}/elt-proxy-reload.sh" <<EOF
#!/bin/sh
ln -sfn "${LE_LIVE}/${PRIMARY_DOMAIN}" "${LE_LIVE}/current"
docker exec elt-proxy /docker-entrypoint.d/40-enable-ssl.sh
docker exec elt-proxy nginx -s reload
EOF
chmod +x "${HOOK_DIR}/elt-proxy-reload.sh"

echo "Restarting proxy to load TLS configuration..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" --profile full up -d proxy

echo ""
echo "TLS enabled for ${PRIMARY_DOMAIN}."
echo "  https://${PRIMARY_DOMAIN}"
if [[ ${#EXTRA_DOMAINS[@]} -gt 0 ]]; then
  echo "  https://${EXTRA_DOMAINS[0]}"
fi
echo ""
echo "Update .env:"
echo "  APP_URL=https://${PRIMARY_DOMAIN}"
echo "  NEXT_PUBLIC_API_URL=https://${PRIMARY_DOMAIN}/api/v1"
echo "Then rebuild the frontend: docker compose --profile full up -d --build frontend"
