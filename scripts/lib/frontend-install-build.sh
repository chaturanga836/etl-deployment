# shellcheck shell=bash
# Build dt-orch-frontend for install using NEXT_PUBLIC_* from the wizard .env.
# Sourced by install.sh and rebuild-frontend-from-source.sh — do not execute directly.

frontend_install_resolve_env_file() {
  local root_dir="$1"
  local state_dir="${2:-}"
  if [[ -n "$state_dir" && -f "${state_dir}/.env" ]]; then
    echo "${state_dir}/.env"
    return
  fi
  local vol
  vol=$(docker volume inspect etl-deployment_installer_state --format '{{ .Mountpoint }}' 2>/dev/null || true)
  if [[ -n "$vol" && -f "$vol/.env" ]]; then
    echo "$vol/.env"
    return
  fi
  if [[ -f "${root_dir}/.env" ]]; then
    echo "${root_dir}/.env"
    return
  fi
  echo ""
}

frontend_install_read_env() {
  local key="$1" file="$2"
  local line
  line=$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 || true)
  [[ -n "$line" ]] || return 0
  local val="${line#*=}"
  val="${val%$'\r'}"
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  printf '%s' "$val"
}

frontend_install_ensure_checkout() {
  local frontend_dir="$1"
  local repo="${ELT_FRONTEND_REPO_HTTPS:-https://github.com/chaturanga836/elt-frontend.git}"
  if [[ -f "${frontend_dir}/Dockerfile" ]]; then
    return 0
  fi
  echo "Cloning elt-frontend into ${frontend_dir} ..."
  mkdir -p "$(dirname "$frontend_dir")"
  git clone --depth 1 "$repo" "$frontend_dir"
}

# Resolve public Keycloak URL for the browser bundle (never leave localhost on customer hosts).
frontend_install_resolve_kc_url() {
  local env_file="$1"
  local kc_url api_url host port
  kc_url="$(frontend_install_read_env NEXT_PUBLIC_KC_URL "$env_file")"
  api_url="$(frontend_install_read_env APP_URL "$env_file")"
  port="$(frontend_install_read_env KEYCLOAK_PORT "$env_file")"
  port="${port:-8081}"

  if [[ -z "$kc_url" ]]; then
    kc_url="http://localhost:${port}"
  fi

  if [[ "$kc_url" == *localhost* || "$kc_url" == *127.0.0.1* ]] && [[ -n "$api_url" ]]; then
    host="$(python3 - "$api_url" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).hostname or "")
PY
)"
    if [[ -n "$host" && "$host" != "localhost" && "$host" != "127.0.0.1" ]]; then
      kc_url="http://${host}:${port}"
    fi
  fi
  printf '%s' "$kc_url"
}

# Build image and pin FRONTEND_IMAGE in env. Sets FRONTEND_IMAGE in caller's shell via stdout eval or return var.
frontend_install_build() {
  local root_dir="$1"
  local env_file="$2"
  local tag="${3:-dt-orch-frontend:install}"
  local frontend_dir="${ELT_FRONTEND:-$root_dir/../elt-frontend}"

  [[ -f "$env_file" ]] || {
    echo "WARN: No .env for frontend build — using registry FRONTEND_IMAGE." >&2
    return 1
  }

  local api_url kc_url kc_realm kc_client build_id
  api_url="$(frontend_install_read_env NEXT_PUBLIC_API_URL "$env_file")"
  kc_url="$(frontend_install_resolve_kc_url "$env_file")"
  kc_realm="$(frontend_install_read_env NEXT_PUBLIC_KC_REALM "$env_file")"
  kc_client="$(frontend_install_read_env NEXT_PUBLIC_KC_CLIENT_ID "$env_file")"
  build_id="$(frontend_install_read_env IMAGE_TAG "$env_file")"

  api_url="${api_url:-http://localhost/api/v1}"
  kc_realm="${kc_realm:-workspace-realm}"
  kc_client="${kc_client:-workspace-web}"
  build_id="${build_id:-install}"

  frontend_install_ensure_checkout "$frontend_dir"

  echo "Building install frontend as ${tag}"
  echo "  NEXT_PUBLIC_KC_URL=${kc_url}"
  echo "  NEXT_PUBLIC_API_URL=${api_url}"

  docker build -t "$tag" "$frontend_dir" \
    --build-arg "NEXT_PUBLIC_API_URL=${api_url}" \
    --build-arg "NEXT_PUBLIC_BUILD_ID=${build_id}" \
    --build-arg "NEXT_PUBLIC_KC_URL=${kc_url}" \
    --build-arg "NEXT_PUBLIC_KC_REALM=${kc_realm}" \
    --build-arg "NEXT_PUBLIC_KC_CLIENT_ID=${kc_client}"

  if grep -q '^FRONTEND_IMAGE=' "$env_file"; then
    sed -i.bak "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=${tag}|" "$env_file"
  else
    echo "FRONTEND_IMAGE=${tag}" >> "$env_file"
  fi
  rm -f "${env_file}.bak"

  export FRONTEND_IMAGE="$tag"
  echo "Pinned FRONTEND_IMAGE=${tag} in ${env_file}"
}
