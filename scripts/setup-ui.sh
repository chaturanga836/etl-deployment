#!/usr/bin/env bash
# Start the DT Orch setup wizard UI (http://127.0.0.1:9080)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f config/license-public.pem ]]; then
  echo "Generating license key pair (dev)..."
  python3 scripts/generate-license-keys.py --out-dir config
fi

echo "Starting setup wizard at http://127.0.0.1:9080"
docker compose -f compose/installer.yml up --build "$@"
