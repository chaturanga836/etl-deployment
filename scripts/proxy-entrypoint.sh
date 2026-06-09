#!/bin/sh
set -e

CONF_DIR=/etc/nginx/conf.d
SSL_CONF="${CONF_DIR}/ssl.conf"
CERT_FILE=/etc/letsencrypt/live/current/fullchain.pem

if [ -f "$CERT_FILE" ]; then
  cp /etc/nginx/templates/ssl.conf.template "$SSL_CONF"
else
  rm -f "$SSL_CONF"
fi
