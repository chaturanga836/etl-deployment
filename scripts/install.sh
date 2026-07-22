#!/usr/bin/env bash
# DT Orch installer — monolith, distributed roles, or config-driven render.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=lib/frontend-install-build.sh
source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"

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

repair_env_file_for_shell() {
  frontend_install_repair_env_file_for_shell "$1"
}

apply_version_defaults_to_env() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  bash "${ROOT_DIR}/scripts/release/sync-env-from-version.sh" "$env_file" "${ROOT_DIR}/VERSION"
}

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
  local resolved="$env_file"
  if [[ "$resolved" != /* ]]; then
    resolved="$ROOT_DIR/$resolved"
  fi
  repair_env_file_for_shell "$resolved"
  apply_version_defaults_to_env "$resolved"
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

bind_mount_rel_paths() {
  printf '%s\n' \
    nginx/default.conf \
    nginx/ssl.conf.template \
    scripts/proxy-entrypoint.sh \
    scripts/init-db.sql \
    config/license-public.pem
}

running_installer_with_docker_sock() {
  [[ -f /.dockerenv ]] && [[ -S /var/run/docker.sock ]]
}

host_deployment_root_exists() {
  local host_root="$1"
  [[ -n "$host_root" ]] || return 1
  if running_installer_with_docker_sock; then
    docker run --rm -v /:/host:ro alpine:3.20 test -d "/host${host_root}"
    return
  fi
  [[ -d "$host_root" ]]
}

host_path_from_mountinfo() {
  awk '$5 == "/opt/etl-deployment" { gsub(/\\040/, " ", $4); print $4; exit }' /proc/self/mountinfo 2>/dev/null || true
}

resolve_deployment_host_root() {
  local root="$ROOT_DIR"
  # Wizard container sees the repo at /opt/etl-deployment; host Docker needs the real checkout path.
  if running_installer_with_docker_sock; then
    local host_root="${ETL_DEPLOYMENT_HOST_ROOT:-}"
    if [[ -n "$host_root" ]] && host_deployment_root_exists "$host_root"; then
      echo "$host_root"
      return 0
    fi

    host_root=""
    local container_name="${INSTALLER_CONTAINER_NAME:-dt-orch-installer}"
    host_root="$(docker inspect "$container_name" --format '{{ range .Mounts }}{{ if eq .Destination "/opt/etl-deployment" }}{{ .Source }}{{ end }}{{ end }}' 2>/dev/null || true)"
    if [[ -z "$host_root" ]]; then
      host_root="$(docker inspect "$HOSTNAME" --format '{{ range .Mounts }}{{ if eq .Destination "/opt/etl-deployment" }}{{ .Source }}{{ end }}{{ end }}' 2>/dev/null || true)"
    fi
    if [[ -z "$host_root" ]]; then
      host_root="$(host_path_from_mountinfo)"
    fi
    if ! host_deployment_root_exists "$host_root"; then
      cat <<'EOF' >&2
ERROR: Cannot resolve the host path for /opt/etl-deployment bind mounts.

The setup wizard runs inside a container but starts platform containers on the host Docker
daemon. Host bind mounts must use the real checkout path (e.g. /home/ubuntu/etl-deployment),
not /opt/etl-deployment inside the container.

Start the wizard with ./scripts/setup-ui.sh (sets ETL_DEPLOYMENT_HOST_ROOT automatically), or
export ETL_DEPLOYMENT_HOST_ROOT to your checkout path before starting the installer.

Ensure compose/installer.yml still mounts the repo at /opt/etl-deployment and retry.
EOF
      return 1
    fi
    echo "$host_root"
    return 0
  fi
  echo "$root"
}

export_deployment_host_root() {
  local resolved=""
  if ! resolved="$(resolve_deployment_host_root)"; then
    exit 1
  fi
  export ETL_DEPLOYMENT_HOST_ROOT="$resolved"
  echo "Deployment host root for bind mounts: ${ETL_DEPLOYMENT_HOST_ROOT}"
}

cleanup_stale_host_bind_mounts() {
  local host_root="${ETL_DEPLOYMENT_HOST_ROOT:-$(resolve_deployment_host_root)}"
  local wrong_base="/opt/etl-deployment"
  local rel
  while IFS= read -r rel; do
    if running_installer_with_docker_sock; then
      docker run --rm -v /:/host:rw alpine:3.20 sh -c "
        p=\"/host${host_root}/${rel}\"
        if [ -d \"\$p\" ]; then
          rm -rf \"\$p\"
          echo \"Removed stale Docker directory: ${host_root}/${rel}\"
        fi
        if [ \"${host_root}\" != \"${wrong_base}\" ] && [ -f \"/host${host_root}/${rel}\" ]; then
          bad=\"/host${wrong_base}/${rel}\"
          if [ -d \"\$bad\" ]; then
            rm -rf \"\$bad\"
            echo \"Removed stale Docker directory: ${wrong_base}/${rel}\"
          fi
        fi
      " 2>/dev/null || true
    elif [[ -d "${host_root}/${rel}" ]]; then
      rm -rf "${host_root}/${rel}"
      echo "Removed stale Docker directory: ${host_root}/${rel}"
    fi
  done < <(bind_mount_rel_paths)
}

preflight_bind_mounts() {
  local root="${ETL_DEPLOYMENT_HOST_ROOT:-}"
  if running_installer_with_docker_sock && [[ -z "$root" ]]; then
    echo "ERROR: ETL_DEPLOYMENT_HOST_ROOT is not set inside the setup wizard container."
    echo "Restart the wizard with: ./scripts/setup-ui.sh"
    exit 1
  fi
  root="${root:-$ROOT_DIR}"
  local rel
  while IFS= read -r rel; do
    local path="${root}/${rel}"
    if running_installer_with_docker_sock; then
      if docker run --rm -v "${root}:/mnt:ro" alpine:3.20 test -f "/mnt/${rel}"; then
        continue
      fi
      echo "ERROR: Required file missing on host for Docker bind mount: ${path}"
      if docker run --rm -v /:/host:ro alpine:3.20 test -d "/host${path}"; then
        echo "That host path is a DIRECTORY (Docker created it when the real file was missing)."
        echo "Remove it on the host, then retry: sudo rm -rf \"${path}\""
        if [[ -f "${ROOT_DIR}/${rel}" ]]; then
          echo "Then restore the file from the repo: cp \"${ROOT_DIR}/${rel}\" \"${path}\""
        fi
      fi
      exit 1
    fi
    if [[ -f "$path" ]]; then
      continue
    fi
    echo "ERROR: Required file missing for Docker bind mount: ${path}"
    if [[ -d "$path" ]]; then
      echo "That path is a DIRECTORY (Docker created it when the real file was missing)."
      echo "Remove it, then retry: rm -rf \"${path}\""
    fi
    exit 1
  done < <(bind_mount_rel_paths)
}

local_dev_sources_available() {
  [[ -f "$ROOT_DIR/../etl-back/Dockerfile" || -f "/opt/etl-back/Dockerfile" ]]
}

maybe_enable_dev_build() {
  if [[ "$DEV_BUILD" == true ]]; then
    return 0
  fi
  case "${INSTALLER_DEV_BUILD:-}" in
    1|true|TRUE|yes|YES)
      DEV_BUILD=true
      echo "INSTALLER_DEV_BUILD enabled — building images instead of pulling from registry."
      return 0
      ;;
  esac
  if local_dev_sources_available; then
    DEV_BUILD=true
    echo "Local source detected — building images instead of pulling from registry."
  fi
}

registry_login_if_configured() {
  local registry="${REGISTRY_URL:-}"
  local token="${REGISTRY_PASSWORD:-${REGISTRY_TOKEN:-${GITHUB_TOKEN:-}}}"
  local user="${REGISTRY_USER:-}"

  [[ -z "$registry" || -z "$token" ]] && return 0

  local host="${registry%%/*}"
  if [[ -z "$user" ]]; then
    user="${GITHUB_USERNAME:-token}"
  fi

  echo "Logging in to container registry (${host})..."
  if ! echo "$token" | docker login "$host" -u "$user" --password-stdin; then
    echo "ERROR: Registry login failed for ${host}."
    exit 1
  fi
}

preflight_registry_access() {
  if [[ "$DEV_BUILD" == true ]]; then
    return 0
  fi

  local missing=()
  local image
  for image in \
    "${API_IMAGE:-}" \
    "${FRONTEND_IMAGE:-}" \
    "${INFRA_IMAGE:-}" \
    "${SCRAPER_IMAGE:-}"; do
    [[ -z "$image" ]] && continue
    echo "Checking registry access for ${image}..."
    if docker manifest inspect "$image" >/dev/null 2>&1; then
      continue
    fi
    missing+=("$image")
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi

  if local_dev_sources_available; then
    DEV_BUILD=true
    echo "Registry unavailable — building from local source instead (--dev)."
    return 0
  fi

  cat <<EOF
ERROR: Cannot pull release image(s) (registry denied or image not found):

$(printf '  - %s\n' "${missing[@]}")

Default DT Orch releases use public GHCR packages — customers do not need the vendor GitHub token.
Verify all images exist for the tag in VERSION:
  ./scripts/release/verify-release-images.sh

If pulls are denied, the vendor must run:
  ./scripts/release/set-packages-public.sh
EOF
  exit 1
}

preflight_license_key() {
  local host_root="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
  if running_installer_with_docker_sock; then
    # Volume paths are resolved on the host Docker daemon, not inside the installer container.
    docker run --rm \
      -v "${host_root}:/work:rw" \
      -v "${host_root}/scripts:/scripts:ro" \
      -v "${host_root}/installer:/installer:ro" \
      python:3.12-slim \
      sh -c 'pip install -q cryptography pyjwt >/dev/null && PYTHONPATH=/installer python3 /scripts/repair-license-keys.py --out-dir /work/config'
  elif command -v python3 >/dev/null 2>&1; then
    PYTHONPATH="${ROOT_DIR}/installer" python3 "${ROOT_DIR}/scripts/repair-license-keys.py" --out-dir "${host_root}/config"
  fi
  local pub="${host_root}/config/license-public.pem"
  if running_installer_with_docker_sock; then
    if docker run --rm -v "${host_root}:/mnt:ro" alpine:3.20 test -f "/mnt/config/license-public.pem"; then
      return 0
    fi
  elif [[ -f "${ROOT_DIR}/config/license-public.pem" ]]; then
    return 0
  fi
  echo "ERROR: Missing ${pub}"
  echo "Run: python3 scripts/repair-license-keys.py --out-dir config"
  echo "Or start the setup wizard once: ./scripts/setup-ui.sh"
  exit 1
}

prepare_runtime_env() {
  local ef="$1"
  if [[ -f "$ef" ]]; then
    # Licensing disabled — never inject LICENSE_KEY into runtime env.
    sed -i.bak '/^LICENSE_KEY=/d' "$ef"
    rm -f "${ef}.bak"
  fi
}

prefer_local_fixed_api_image() {
  local ef="$1"
  local tag="${LOCAL_API_IMAGE:-dt-orch-api:fixed}"
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    return 0
  fi
  API_IMAGE="$tag"
  if grep -q '^API_IMAGE=' "$ef"; then
    sed -i.bak "s|^API_IMAGE=.*|API_IMAGE=${tag}|" "$ef"
  else
    echo "API_IMAGE=${tag}" >> "$ef"
  fi
  rm -f "${ef}.bak"
  echo "Using locally built API image: ${tag}"
}

build_install_frontend_image() {
  local ef="$1"
  if [[ "${BUILD_INSTALL_FRONTEND:-true}" != "true" ]]; then
    return 0
  fi
  # shellcheck source=lib/frontend-install-build.sh
  source "${ROOT_DIR}/scripts/lib/frontend-install-build.sh"
  frontend_install_patch_env_public_urls "$ef" || true
  if frontend_install_build "$ROOT_DIR" "$ef" "dt-orch-frontend:install" "install"; then
    if [[ -n "${STATE_DIR:-}" ]]; then
      frontend_install_verify_image "$ef" || return 1
    fi
    frontend_install_snapshot_env_on_host "$ef" || true
    return 0
  fi
  if [[ -n "${STATE_DIR:-}" ]] || [[ "$DEV_BUILD" == true ]]; then
    echo "ERROR: Frontend build failed — cannot install with registry image (localhost Keycloak URLs)." >&2
    echo "Common causes: disk full (df -h /), Docker bloat (docker system df)," >&2
    echo "  private elt-frontend repo (clone needs GITHUB_TOKEN), npm build OOM." >&2
    echo "Free space on the EC2 host, then:" >&2
    echo "  docker builder prune -af && docker system prune -af" >&2
    echo "  git clone https://<GITHUB_PAT>@github.com/chaturanga836/elt-frontend.git \$(dirname \"\$PWD\")/elt-frontend" >&2
    echo "  bash scripts/rebuild-frontend-from-source.sh --public-host YOUR_PUBLIC_IP" >&2
    return 1
  fi
  frontend_install_restore_registry_frontend_image "$ef" || true
  echo "WARN: Install-time frontend build skipped; using registry FRONTEND_IMAGE from .env." >&2
  echo "WARN: Registry images redirect login to localhost — rebuild frontend before customer use." >&2
  return 0
}

show_api_failure_logs() {
  if docker ps -a --format '{{.Names}}' | grep -qx 'dt-orch-api'; then
    echo ""
    echo "---- dt-orch-api logs (last 60 lines) ----"
    docker logs dt-orch-api --tail 60 2>&1 || true
    echo "----------------------------------------"
  fi
}

show_keycloak_failure_logs() {
  if docker ps -a --format '{{.Names}}' | grep -qx 'elt-keycloak'; then
    echo ""
    echo "---- elt-keycloak logs (last 80 lines) ----"
    docker logs elt-keycloak --tail 80 2>&1 || true
    echo "------------------------------------------"
  fi
}

keycloak_bootstrap_base() {
  local port="${KEYCLOAK_PORT:-8081}"
  if running_installer_with_docker_sock; then
    echo "http://${KC_INSTALLER_HOST:-host.docker.internal}:${port}"
    return 0
  fi
  local base="${KC_BOOTSTRAP_URL:-http://localhost:${port}}"
  echo "${base%/}"
}

# HTTP probe for Keycloak — from the wizard container use host networking (127.0.0.1:8081).
keycloak_http_ready() {
  local url="$1"
  local port="${KEYCLOAK_PORT:-8081}"
  if running_installer_with_docker_sock; then
    docker run --rm --network host alpine:3.20 \
      sh -c "wget -q -O /dev/null 'http://127.0.0.1:${port}/realms/master'" 2>/dev/null \
      || curl -sf "$url" >/dev/null 2>&1
    return
  fi
  curl -sf "$url" >/dev/null 2>&1
}

# Host-published service URL when install.sh runs inside the wizard container.
host_loopback_base() {
  local port="$1"
  if running_installer_with_docker_sock; then
    echo "http://${KC_INSTALLER_HOST:-host.docker.internal}:${port}"
    return 0
  fi
  echo "http://127.0.0.1:${port}"
}

wait_for_keycloak() {
  local kc_url attempts sleep_sec i status
  kc_url="$(keycloak_bootstrap_base)/realms/master"
  attempts="${KEYCLOAK_WAIT_ATTEMPTS:-180}"
  sleep_sec="${KEYCLOAK_WAIT_SLEEP:-2}"
  echo "Waiting for Keycloak at ${kc_url} (up to $((attempts * sleep_sec))s)..."
  echo "First boot on a fresh DB can take several minutes; HTTP readiness is checked every ${sleep_sec}s."

  for i in $(seq 1 "$attempts"); do
    if keycloak_http_ready "$kc_url"; then
      echo "Keycloak is ready."
      return 0
    fi

    status="unknown"
    if docker ps --format '{{.Names}}' | grep -qx 'elt-keycloak'; then
      status="$(docker inspect elt-keycloak --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' 2>/dev/null || echo missing)"
      if [[ "$status" == "unhealthy" && $((i % 15)) -eq 0 ]]; then
        echo "  ... Keycloak Docker health is unhealthy (first boot can take 5–10 min); still probing HTTP..."
      fi
    elif docker ps -a --format '{{.Names}}' | grep -qx 'elt-keycloak'; then
      echo "Keycloak container exited before becoming ready."
      show_keycloak_failure_logs
      return 1
    fi

    if [[ "$i" -eq "$attempts" ]]; then
      echo "Keycloak health check timed out."
      show_keycloak_failure_logs
      return 1
    fi
    if [[ $((i % 15)) -eq 0 ]]; then
      echo "  ... still waiting (container=${status}, ~$((i * sleep_sec))s elapsed)"
    fi
    sleep "$sleep_sec"
  done
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

reconcile_bundled_postgres_credentials() {
  local ef="$1"
  local changed=false

  # Empty POSTGRES_PASSWORD makes compose fall back to changeme while DATABASE_URL keeps no password.
  if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
    POSTGRES_PASSWORD="changeme"
    if grep -q '^POSTGRES_PASSWORD=' "$ef"; then
      sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=changeme/' "$ef"
      rm -f "${ef}.bak"
    else
      echo "POSTGRES_PASSWORD=changeme" >> "$ef"
    fi
    changed=true
    echo "Set POSTGRES_PASSWORD=changeme (bundled database default)"
  fi

  # DATABASE_URL with empty password: postgresql://user:@host...
  if [[ "${DATABASE_URL:-}" == *":@"* ]]; then
    local user="${POSTGRES_USER:-elt}"
    local meta_db="${DTORC_METADATA_DB_NAME:-dtorc_metadata}"
    local ws_db="${DTORC_WORKSPACE_DB_NAME:-dtorc_workspace}"
    DATABASE_URL="postgresql://${user}:${POSTGRES_PASSWORD}@postgres:5432/${meta_db}"
    WORKSPACE_DATABASE_URL="postgresql://${user}:${POSTGRES_PASSWORD}@postgres:5432/${ws_db}"
    if grep -q '^DATABASE_URL=' "$ef"; then
      sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ef"
    else
      echo "DATABASE_URL=${DATABASE_URL}" >> "$ef"
    fi
    if grep -q '^WORKSPACE_DATABASE_URL=' "$ef"; then
      sed -i.bak "s|^WORKSPACE_DATABASE_URL=.*|WORKSPACE_DATABASE_URL=${WORKSPACE_DATABASE_URL}|" "$ef"
    else
      echo "WORKSPACE_DATABASE_URL=${WORKSPACE_DATABASE_URL}" >> "$ef"
    fi
    rm -f "${ef}.bak"
    changed=true
    echo "Fixed DATABASE_URL (was missing password)"
  fi

  [[ "$changed" == true ]]
}

generate_secrets_if_missing() {
  local ef
  ef="$(env_file_path)"
  # shellcheck disable=SC1091
  set -a
  source "$ef"
  set +a

  local updated=false

  if reconcile_bundled_postgres_credentials "$ef"; then
    updated=true
  fi

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

maybe_enable_dev_build
registry_login_if_configured
preflight_registry_access
export_deployment_host_root
cleanup_stale_host_bind_mounts
preflight_bind_mounts
preflight_license_key
prepare_runtime_env "$EF"
prefer_local_fixed_api_image "$EF"
if ! build_install_frontend_image "$EF"; then
  exit 1
fi
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
  # Always probe via host loopback — never APP_URL (public host may be wrong,
  # unreachable from this host, or an email mistaken for a hostname).
  if [[ "$PROFILE" == "full" ]]; then
    HEALTH_URL="$(host_loopback_base "${HTTP_PORT:-80}")/health"
  else
    HEALTH_URL="$(host_loopback_base "${API_PORT:-8000}")/health"
  fi
fi

read -r -a COMPOSE_ARGS <<< "$(compose_files)"
BUILD_ARGS=()
if [[ "$DEV_BUILD" == true ]]; then
  BUILD_ARGS=(--build)
fi

echo "Starting DT Orch (profile: ${PROFILE})..."
# shellcheck disable=SC2086
PROFILE_ARGS=(--profile "$PROFILE")
# Enable optional workspace MySQL / Mongo services when rendered into .env.
if [[ -n "${EXTRA_COMPOSE_PROFILES:-}" ]]; then
  IFS=',' read -r -a _extra_profiles <<< "${EXTRA_COMPOSE_PROFILES}"
  for _p in "${_extra_profiles[@]}"; do
    _p="$(echo "$_p" | xargs)"
    [[ -n "$_p" ]] && PROFILE_ARGS+=(--profile "$_p")
  done
fi
if ! docker_compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" --env-file "$EF" up -d "${BUILD_ARGS[@]}"; then
  show_api_failure_logs
  exit 1
fi

if [[ "$PROFILE" == "frontend" ]]; then
  echo "Frontend profile started. Open http://localhost:${FRONTEND_PORT:-3000}"
  exit 0
fi

if [[ "$PROFILE" == "auth" ]]; then
  wait_for_keycloak
  echo "Auth profile started. Keycloak: http://localhost:${KEYCLOAK_PORT:-8081}"
  exit 0
fi

wait_for_keycloak

echo "Waiting for API health at ${HEALTH_URL}..."
for i in $(seq 1 90); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Health check passed."
    break
  fi
  if [[ "$i" -eq 90 ]]; then
    echo "Health check timed out. Inspect logs with: docker compose logs (or docker-compose logs)"
    show_api_failure_logs
    exit 1
  fi
  sleep 2
done

# Warm shared BaaS services when running the full monolith profile.
if [[ "$PROFILE" == "full" || "$PROFILE" == "backend" ]]; then
  minio_health_url="$(host_loopback_base "${MINIO_PORT:-9000}")/minio/health/live"
  echo "Checking shared MinIO health at ${minio_health_url}..."
  for i in $(seq 1 30); do
    if curl -sf "$minio_health_url" >/dev/null 2>&1; then
      echo "MinIO health check passed."
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      echo "WARNING: MinIO health check timed out (shared object storage may be unavailable)."
    fi
    sleep 2
  done

  centrifugo_health_url="$(host_loopback_base "${CENTRIFUGO_PORT:-8001}")/health"
  echo "Checking shared Centrifugo health at ${centrifugo_health_url}..."
  for i in $(seq 1 30); do
    if curl -sf "$centrifugo_health_url" >/dev/null 2>&1; then
      echo "Centrifugo health check passed."
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      echo "WARNING: Centrifugo health check timed out (realtime notifications may be unavailable)."
    fi
    sleep 2
  done
fi

cat <<EOF

DT Orch is running (profile: ${PROFILE}).

  Stack URL:       ${APP_URL:-http://localhost}
  API (direct):    http://localhost:${API_PORT:-8000}
  Keycloak:        http://localhost:${KEYCLOAK_PORT:-8081}
  MinIO:           http://localhost:${MINIO_PORT:-9000}
  Centrifugo:      http://localhost:${CENTRIFUGO_PORT:-8001}

Database migrations run automatically when the API container starts.

EOF
