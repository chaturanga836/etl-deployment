#!/usr/bin/env bash
# Check API and optional infra-service health (host loopback, with retries).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "${ENV_FILE:-.env}" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${ENV_FILE:-.env}"
  set +a
fi

# Never default to APP_URL — public host may be unreachable from this host (EC2 hairpin).
if [[ -n "${HEALTH_URL:-}" ]]; then
  API_URL="$HEALTH_URL"
else
  API_URL="http://127.0.0.1:${HTTP_PORT:-80}/health"
fi

INFRA_URL="${INFRA_HEALTH_URL:-http://127.0.0.1:${INFRA_SERVICE_PORT:-9100}/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-90}"
HEALTH_SLEEP="${HEALTH_SLEEP:-2}"

fail=0

check_with_retry() {
  local name="$1"
  local url="$2"
  local retries="${3:-$HEALTH_RETRIES}"

  echo "Waiting for ${name} at ${url}..."
  for i in $(seq 1 "$retries"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "OK   ${name} (${url})"
      return 0
    fi
    if [[ "$i" -eq "$retries" ]]; then
      echo "FAIL ${name} (${url})"
      return 1
    fi
    sleep "$HEALTH_SLEEP"
  done
  return 1
}

check_once() {
  local name="$1"
  local url="$2"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "OK   ${name} (${url})"
  else
    echo "FAIL ${name} (${url})"
    return 1
  fi
}

if ! check_with_retry "api" "$API_URL"; then
  fail=1
fi

if ! check_once "infra" "$INFRA_URL"; then
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Hint: docker logs dt-orch-api --tail 80" >&2
  exit 1
fi

echo "All health checks passed."
