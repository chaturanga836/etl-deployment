#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${1:-full}"
HEALTH_URL="${HEALTH_URL:-}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — review secrets before production use."
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "$HEALTH_URL" ]]; then
  if [[ "$PROFILE" == "full" ]]; then
    HEALTH_URL="${APP_URL:-http://localhost}/health"
  else
    HEALTH_URL="http://localhost:${API_PORT:-8000}/health"
  fi
fi

echo "Starting ELT Engine (profile: ${PROFILE})..."
docker compose --profile "$PROFILE" up -d --build

if [[ "$PROFILE" == "frontend" ]]; then
  echo "Frontend profile started. Open http://localhost:${FRONTEND_PORT:-3000}"
  echo "Ensure NEXT_PUBLIC_API_URL in .env points to your remote API before building."
  exit 0
fi

if [[ "$PROFILE" == "auth" ]]; then
  echo "Auth profile started. Keycloak: http://localhost:${KEYCLOAK_PORT:-8081}"
  exit 0
fi

echo "Waiting for API health at ${HEALTH_URL}..."
for i in $(seq 1 60); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Health check passed."
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "Health check timed out. Inspect logs with: docker compose --profile ${PROFILE} logs"
    exit 1
  fi
  sleep 2
done

cat <<EOF

ELT Engine is running (profile: ${PROFILE}).

  Full stack URL:  ${APP_URL:-http://localhost}
  API (direct):    http://localhost:8000  (backend profile only)
  Keycloak:        http://localhost:${KEYCLOAK_PORT:-8081}
  Frontend direct: http://localhost:3000  (frontend profile only)

Database migrations run automatically when the API container starts.

EOF
