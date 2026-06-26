#!/usr/bin/env bash
# DT Orch installer — monolith, distributed roles, or config-driven render.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE=""
CONFIG=""
ROLE=""
DEV_BUILD=false
SCALE=""
STATE_DIR="${STATE_DIR:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [OPTIONS] [PROFILE]

Profiles (monolith):
  full       Entire stack behind nginx (default)
  backend    API, worker, postgres, redis, infra, scraper
  frontend   Next.js only
  auth       Postgres + Keycloak

Options:
  --config PATH     Render .env + manifest.json from deployment JSON, then exit unless profile/role set
  --state-dir PATH  Use .env and secrets from this directory (installer wizard)
  --role NAME       Distributed role: api | worker | frontend | infra
  --dev             Use compose/docker-compose.dev.yml (build from sibling repos)
  --scale N         Worker replicas (with --role worker)
  -h, --help        Show this help

Examples:
  ./scripts/install.sh --config schema/examples/monolith-bundled.json full
  ./scripts/install.sh monolith full
  ./scripts/install.sh --role api
  ./scripts/install.sh --role worker --scale 3
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --dev) DEV_BUILD=true; shift ;;
    --scale) SCALE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    monolith) PROFILE="${PROFILE:-full}"; shift ;;
    full|backend|frontend|auth)
      PROFILE="$1"; shift ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

ensure_env() {
  local env_file=".env"
  if [[ -n "$STATE_DIR" && -f "${STATE_DIR}/.env" ]]; then
    env_file="${STATE_DIR}/.env"
  fi
  if [[ ! -f "$env_file" ]]; then
    if [[ -f .env.platform.example ]]; then
      cp .env.platform.example .env
      echo "Created .env from .env.platform.example"
    else
      echo "ERROR: No .env found. Copy .env.platform.example or use --config."
      exit 1
    fi
  fi
  ENV_FILE="${ENV_FILE:-$env_file}"
}

env_file_path() {
  if [[ -n "${ENV_FILE:-}" ]]; then
    echo "$ENV_FILE"
  elif [[ -n "$STATE_DIR" && -f "${STATE_DIR}/.env" ]]; then
    echo "${STATE_DIR}/.env"
  else
    echo ".env"
  fi
}

resolve_env_file() {
  local path
  path="$(env_file_path)"
  if [[ "$path" != /* ]]; then
    path="$ROOT_DIR/$path"
  fi
  echo "$path"
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi
  echo "ERROR: Docker Compose is not available (docker compose plugin or docker-compose binary)."
  echo "Install docker-compose-plugin: https://docs.docker.com/compose/install/linux/"
  exit 1
}

generate_secrets_if_missing() {
  local ef
  ef="$(env_file_path)"
  # shellcheck disable=SC1091
  set -a
  source "$ef"
  set +a

  local updated=false

  if [[ -z "${FERNET_KEY:-}" ]]; then
    FERNET_KEY="$(openssl rand -base64 32)"
    echo "FERNET_KEY=${FERNET_KEY}" >> "$ef"
    updated=true
    echo "Generated FERNET_KEY"
  fi

  if [[ "${INTERNAL_SERVICE_TOKEN:-changeme-internal-token}" == "changeme-internal-token" ]]; then
    deploy_env="${DTORCH_ENV:-${ELT_ENV:-development}}"
    if [[ "$deploy_env" == "production" ]]; then
      echo "ERROR: Set INTERNAL_SERVICE_TOKEN before production install."
      exit 1
    fi
    INTERNAL_SERVICE_TOKEN="$(openssl rand -hex 32)"
    if grep -q '^INTERNAL_SERVICE_TOKEN=' "$ef"; then
      sed -i.bak "s/^INTERNAL_SERVICE_TOKEN=.*/INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN}/" "$ef"
      rm -f .env.bak
    else
      echo "INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN}" >> "$ef"
    fi
    updated=true
    echo "Generated INTERNAL_SERVICE_TOKEN (development)"
  fi

  if [[ "$updated" == true ]]; then
  # shellcheck disable=SC1091
    set -a
    source "$ef"
    set +a
  fi
}

production_guards() {
  local ef
  ef="$(env_file_path)"
  # shellcheck disable=SC1091
  set -a
  source "$ef"
  set +a

  deploy_env="${DTORCH_ENV:-${ELT_ENV:-development}}"
  if [[ "$deploy_env" != "production" ]]; then
    return 0
  fi

  if [[ "${SANDBOX_ENABLED:-true}" != "true" ]]; then
    echo "ERROR: SANDBOX_ENABLED must be true in production."
    exit 1
  fi

  if [[ "${POSTGRES_PASSWORD:-changeme}" == "changeme" ]]; then
    echo "ERROR: Change POSTGRES_PASSWORD before production install."
    exit 1
  fi
}

render_config() {
  local out_dir="$ROOT_DIR"
  if [[ -n "$STATE_DIR" ]]; then
    out_dir="$STATE_DIR"
  fi
  python3 "${ROOT_DIR}/renderer/render.py" --config "$CONFIG" --out "$out_dir" --helm-values
  echo "Rendered .env and manifest.json from ${CONFIG}"
}

compose_files() {
  local files=()
  if [[ -n "$ROLE" ]]; then
    case "$ROLE" in
      api) files+=(-f compose/roles/api.yml) ;;
      worker) files+=(-f compose/roles/worker.yml) ;;
      frontend) files+=(-f compose/roles/frontend.yml) ;;
      infra) files+=(-f compose/roles/infra.yml) ;;
      *) echo "Unknown role: $ROLE"; exit 1 ;;
    esac
  else
    files+=(-f compose/monolith.yml)
    if [[ "$DEV_BUILD" == true ]]; then
      files+=(-f compose/docker-compose.dev.yml)
    fi
  fi
  echo "${files[@]}"
}

if [[ -n "$CONFIG" ]]; then
  render_config
fi

ensure_env
generate_secrets_if_missing
production_guards

EF="$(resolve_env_file)"
export ENV_FILE="$EF"
# shellcheck disable=SC1091
set -a
source "$EF"
set +a

if [[ -n "$ROLE" ]]; then
  echo "Ensuring Docker networks exist..."
  docker_compose -f compose/networks.yml up -d

  read -r -a COMPOSE_ARGS <<< "$(compose_files)"
  SCALE_ARGS=()
  if [[ "$ROLE" == "worker" && -n "$SCALE" ]]; then
    SCALE_ARGS=(--scale "worker=${SCALE}")
  fi

  BUILD_ARGS=()
  if [[ "$DEV_BUILD" == true ]]; then
    BUILD_ARGS=(--build)
  fi

  echo "Starting role: ${ROLE}..."
  # shellcheck disable=SC2086
  docker_compose "${COMPOSE_ARGS[@]}" --env-file "$EF" up -d "${BUILD_ARGS[@]}" "${SCALE_ARGS[@]}"
  echo "Role ${ROLE} started."
  exit 0
fi

PROFILE="${PROFILE:-full}"
HEALTH_URL="${HEALTH_URL:-}"

if [[ -z "$HEALTH_URL" ]]; then
  if [[ "$PROFILE" == "full" ]]; then
    HEALTH_URL="${APP_URL:-http://localhost}/health"
  else
    HEALTH_URL="http://localhost:${API_PORT:-8000}/health"
  fi
fi

read -r -a COMPOSE_ARGS <<< "$(compose_files)"
BUILD_ARGS=()
if [[ "$DEV_BUILD" == true ]]; then
  BUILD_ARGS=(--build)
fi

echo "Starting DT Orch (profile: ${PROFILE})..."
# shellcheck disable=SC2086
docker_compose "${COMPOSE_ARGS[@]}" --profile "$PROFILE" --env-file "$EF" up -d "${BUILD_ARGS[@]}"

if [[ "$PROFILE" == "frontend" ]]; then
  echo "Frontend profile started. Open http://localhost:${FRONTEND_PORT:-3000}"
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
    echo "Health check timed out. Inspect logs with: docker compose logs (or docker-compose logs)"
    exit 1
  fi
  sleep 2
done

cat <<EOF

DT Orch is running (profile: ${PROFILE}).

  Stack URL:       ${APP_URL:-http://localhost}
  API (direct):    http://localhost:${API_PORT:-8000}
  Keycloak:        http://localhost:${KEYCLOAK_PORT:-8081}
  Infra service:   http://localhost:${INFRA_SERVICE_PORT:-9000}

Database migrations run automatically when the API container starts.

EOF
