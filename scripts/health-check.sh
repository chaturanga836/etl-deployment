#!/usr/bin/env bash
# Check API and optional infra-service health.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

API_URL="${HEALTH_URL:-${APP_URL:-http://localhost}/health}"
INFRA_URL="${PLATFORM_INFRA_URL:-http://localhost:9000}/health"

fail=0

check() {
  local name="$1"
  local url="$2"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "OK   ${name} (${url})"
  else
    echo "FAIL ${name} (${url})"
    fail=1
  fi
}

check "api" "$API_URL"
check "infra" "$INFRA_URL"

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "All health checks passed."
