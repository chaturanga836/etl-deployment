#!/usr/bin/env bash
# Sync REGISTRY_URL / IMAGE_TAG / *_IMAGE from etl-deployment/VERSION into install .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-$ROOT/.env}}"
VERSION_FILE="${2:-$ROOT/VERSION}"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "WARN: VERSION not found at $VERSION_FILE — skipping sync"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "WARN: .env not found at $ENV_FILE — skipping sync"
  exit 0
fi

python3 "$ROOT/scripts/release/version_lib.py" sync-env "$ENV_FILE" "$VERSION_FILE"
