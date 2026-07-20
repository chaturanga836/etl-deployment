# shellcheck shell=bash
# Build dt-orch-frontend for install using NEXT_PUBLIC_* from the wizard .env.
# Sourced by install.sh and rebuild-frontend-from-source.sh — do not execute directly.

frontend_install_in_installer() {
  [[ -f /.dockerenv ]] && [[ -S /var/run/docker.sock ]]
}

# Quote values with whitespace so `source .env` is safe (container dumps omit quotes).
frontend_install_repair_env_file_for_shell() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  python3 - "$env_file" <<'PY'
import re
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
changed = False
out = []
for line in lines:
    if line.lstrip().startswith("#") or not line.strip():
        out.append(line)
        continue
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
    if not match:
        out.append(line)
        continue
    key, val = match.group(1), match.group(2)
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        out.append(line)
        continue
    if re.search(r"\s", val):
        esc = val.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
        out.append(f'{key}="{esc}"')
        changed = True
    else:
        out.append(line)
if changed:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"Repaired unquoted .env values in {path}", file=sys.stderr)
PY
}

# True when .env has enough config for compose (non-empty DATABASE_URL, no registry placeholder).
frontend_install_env_is_usable() {
  local env_file="$1"
  [[ -f "$env_file" && -s "$env_file" ]] || return 1
  grep -qE '^DATABASE_URL=.+' "$env_file" || return 1
  if grep -qE '^API_IMAGE=.*YOUR_GITHUB_ORG' "$env_file" 2>/dev/null; then
    return 1
  fi
  if grep -qE '^REGISTRY_URL=.*YOUR_GITHUB_ORG' "$env_file" 2>/dev/null; then
    return 1
  fi
  return 0
}

frontend_install_find_installer_state_volume() {
  local vol mount vol_name
  for vol in etl-deployment_installer_state compose_installer_state installer_state dt-orch_installer_state; do
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      echo "$vol"
      return 0
    fi
  done
  while read -r vol_name; do
    [[ -n "$vol_name" ]] || continue
    echo "$vol_name"
    return 0
  done < <(docker volume ls -q | grep -E 'installer_state$' || true)
  return 1
}

frontend_install_copy_volume_env() {
  local vol="$1"
  local dest="$2"
  local mount
  mount=$(docker volume inspect "$vol" --format '{{ .Mountpoint }}' 2>/dev/null || true)
  if [[ -n "$mount" && -s "$mount/.env" ]]; then
    cp "$mount/.env" "$dest"
    return 0
  fi
  if docker run --rm -v "${vol}:/state:ro" alpine:3.20 test -s /state/.env 2>/dev/null; then
    docker run --rm -v "${vol}:/state:ro" alpine:3.20 cat /state/.env >"$dest"
    [[ -s "$dest" ]]
    return
  fi
  return 1
}

frontend_install_persist_env_to_installer_volume() {
  local env_file="$1"
  local vol
  vol="$(frontend_install_find_installer_state_volume || true)"
  [[ -n "$vol" && -f "$env_file" ]] || return 0
  docker run --rm -v "${vol}:/state" -v "${env_file}:/env:ro" alpine:3.20 cp /env /state/.env
}

# Rebuild .env from the running stack or installer deployment.json (no manual steps).
frontend_install_recover_env_file() {
  local root_dir="$1"
  local out_file="$2"
  local vol deployment_json out_dir

  if docker ps --format '{{.Names}}' | grep -qx 'dt-orch-api'; then
    docker inspect dt-orch-api --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | LC_ALL=C sort >"$out_file"
    if frontend_install_env_is_usable "$out_file"; then
      echo "Recovered .env from running dt-orch-api container" >&2
      return 0
    fi
    rm -f "$out_file"
  fi

  vol="$(frontend_install_find_installer_state_volume || true)"
  if [[ -n "$vol" ]] && docker run --rm -v "${vol}:/state:ro" alpine:3.20 test -s /state/deployment.json 2>/dev/null; then
    deployment_json="${root_dir}/.deployment-recover.json"
    out_dir="$(dirname "$out_file")"
    docker run --rm -v "${vol}:/state:ro" alpine:3.20 cat /state/deployment.json >"$deployment_json"
    if [[ -s "$deployment_json" ]]; then
      python3 "${root_dir}/renderer/render.py" --config "$deployment_json" --out "$out_dir" >/dev/null
      rm -f "$deployment_json"
      if [[ -f "${out_dir}/.env" ]]; then
        mv "${out_dir}/.env" "$out_file"
        if frontend_install_env_is_usable "$out_file"; then
          echo "Recovered .env from installer deployment.json" >&2
          return 0
        fi
      fi
    fi
    rm -f "$deployment_json"
  fi

  rm -f "$out_file"
  return 1
}

# Resolve installer .env; auto-recover when missing, empty, or wiped (e.g. after partial clean).
frontend_install_ensure_env_file() {
  local root_dir="$1"
  local state_dir="${2:-}"
  local env_file=""

  env_file="$(frontend_install_resolve_env_file "$root_dir" "$state_dir")"
  if [[ -n "$env_file" && -f "$env_file" ]] && frontend_install_env_is_usable "$env_file"; then
    frontend_install_repair_env_file_for_shell "$env_file"
    frontend_install_patch_env_public_urls "$env_file"
    frontend_install_persist_env_to_installer_volume "$env_file"
    echo "$env_file"
    return 0
  fi

  if [[ -n "$env_file" && -f "$env_file" ]]; then
    echo "WARN: Installer .env is missing or incomplete (${env_file}) — recovering automatically..." >&2
  else
    echo "WARN: No usable installer .env found — recovering automatically..." >&2
  fi

  env_file="${root_dir}/.env"
  if ! frontend_install_recover_env_file "$root_dir" "$env_file"; then
    echo "ERROR: Could not recover installer .env." >&2
    echo "  Stack not running and no deployment.json in installer state volume." >&2
    echo "  Run: bash scripts/fresh-install.sh --yes" >&2
    return 1
  fi

  chmod 600 "$env_file" 2>/dev/null || true
  frontend_install_repair_env_file_for_shell "$env_file"
  frontend_install_patch_env_public_urls "$env_file"
  frontend_install_persist_env_to_installer_volume "$env_file"
  rm -f "${root_dir}/.installer-state.env"
  echo "$env_file"
  return 0
}

frontend_install_resolve_env_file() {
  local root_dir="$1"
  local state_dir="${2:-}"

  if [[ -n "${ENV_FILE:-}" && -f "${ENV_FILE}" && -s "${ENV_FILE}" ]]; then
    echo "${ENV_FILE}"
    return
  fi

  if [[ -n "$state_dir" && -s "${state_dir}/.env" ]]; then
    echo "${state_dir}/.env"
    return
  fi

  for vol in etl-deployment_installer_state compose_installer_state installer_state dt-orch_installer_state; do
    local mount
    mount=$(docker volume inspect "$vol" --format '{{ .Mountpoint }}' 2>/dev/null || true)
    if [[ -n "$mount" && -s "$mount/.env" ]]; then
      echo "$mount/.env"
      return
    fi
    # Volume mountpoints are often root-only on Linux — read via a throwaway container.
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      if docker run --rm -v "${vol}:/state:ro" alpine:3.20 test -s /state/.env 2>/dev/null; then
        local tmp="${root_dir}/.installer-state.env"
        docker run --rm -v "${vol}:/state:ro" alpine:3.20 cat /state/.env >"$tmp"
        if [[ -s "$tmp" ]]; then
          echo "$tmp"
          return
        fi
        rm -f "$tmp"
      fi
    fi
  done

  # Any docker volume ending in installer_state (compose project name varies).
  local vol_name mount
  while read -r vol_name; do
    [[ -n "$vol_name" ]] || continue
    mount=$(docker volume inspect "$vol_name" --format '{{ .Mountpoint }}' 2>/dev/null || true)
    if [[ -n "$mount" && -s "$mount/.env" ]]; then
      echo "$mount/.env"
      return
    fi
    if docker run --rm -v "${vol_name}:/state:ro" alpine:3.20 test -s /state/.env 2>/dev/null; then
      local tmp="${root_dir}/.installer-state.env"
      docker run --rm -v "${vol_name}:/state:ro" alpine:3.20 cat /state/.env >"$tmp"
      if [[ -s "$tmp" ]]; then
        echo "$tmp"
        return
      fi
      rm -f "$tmp"
    fi
  done < <(docker volume ls -q | grep -E 'installer_state$' || true)

  if [[ -s "${root_dir}/.install.state.env" ]]; then
    echo "${root_dir}/.install.state.env"
    return
  fi

  if [[ -s "${root_dir}/.env" ]]; then
    echo "${root_dir}/.env"
    return
  fi

  if [[ -s "/opt/etl-deployment-state/.env" ]]; then
    echo "/opt/etl-deployment-state/.env"
    return
  fi

  echo ""
}

# Build a temporary .env from a running stack or explicit public host (when wizard volume is missing).
frontend_install_materialize_env_file() {
  local root_dir="$1"
  local public_host="${2:-}"
  local tmp="${root_dir}/.frontend-rebuild.env"
  local app_url="" kc_port="8081" api_url="" kc_url=""

  if [[ -z "$public_host" ]] && docker ps --format '{{.Names}}' | grep -qx 'dt-orch-api'; then
    app_url="$(docker inspect dt-orch-api --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep -E '^APP_URL=' | head -1 | cut -d= -f2- || true)"
    kc_port="$(docker inspect dt-orch-api --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep -E '^KEYCLOAK_PORT=' | head -1 | cut -d= -f2- || true)"
  fi

  if [[ -z "$public_host" && -n "$app_url" ]]; then
    public_host="$(python3 - "$app_url" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).hostname or "")
PY
)"
  fi

  if [[ -z "$public_host" ]]; then
    public_host="$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  fi

  if [[ -z "$public_host" ]]; then
    echo ""
    return 1
  fi

  kc_port="${kc_port:-8081}"
  app_url="${app_url:-http://${public_host}}"
  api_url="http://${public_host}/api/v1"
  # Keycloak is proxied on APP_URL (/realms/), not :8081 in the browser.
  kc_url="${app_url}"

  cat >"$tmp" <<EOF
# Generated by frontend-install-build.sh for rebuild-frontend-from-source.sh
APP_URL=${app_url}
NEXT_PUBLIC_API_URL=${api_url}
NEXT_PUBLIC_KC_URL=${kc_url}
KEYCLOAK_PORT=${kc_port}
NEXT_PUBLIC_KC_REALM=workspace-realm
NEXT_PUBLIC_KC_CLIENT_ID=workspace-web
IMAGE_TAG=install
FRONTEND_IMAGE=dt-orch-frontend:install
EOF
  echo "$tmp"
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

# Host path for elt-frontend checkout (Docker build context on the host daemon).
frontend_install_resolve_frontend_dir() {
  local root_dir="$1"

  if [[ -n "${ELT_FRONTEND:-}" ]]; then
    echo "${ELT_FRONTEND}"
    return 0
  fi

  local host_root="${ETL_DEPLOYMENT_HOST_ROOT:-}"
  if frontend_install_in_installer; then
    if [[ -z "$host_root" ]]; then
      echo "ERROR: ETL_DEPLOYMENT_HOST_ROOT is required to build the frontend inside the setup wizard." >&2
      return 1
    fi
    echo "$(dirname "$host_root")/elt-frontend"
    return 0
  fi

  host_root="$(cd "$root_dir" && pwd)"
  echo "$(dirname "$host_root")/elt-frontend"
}

frontend_install_clone_repo_url() {
  local repo="${1:-${ELT_FRONTEND_REPO_HTTPS:-https://github.com/chaturanga836/elt-frontend.git}}"
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

  if [[ -z "$token" ]]; then
    printf '%s' "$repo"
    return 0
  fi

  if [[ "$repo" =~ ^https://github\.com/ ]]; then
    printf 'https://%s@github.com/%s' "$token" "${repo#https://github.com/}"
    return 0
  fi

  printf '%s' "$repo"
}

frontend_install_host_dockerfile_exists() {
  local frontend_dir="$1"
  local name parent

  if [[ -f "${frontend_dir}/Dockerfile" ]]; then
    return 0
  fi

  if ! frontend_install_in_installer; then
    return 1
  fi

  name="$(basename "$frontend_dir")"
  parent="$(dirname "$frontend_dir")"
  docker run --rm -v "${parent}:/work:ro" alpine:3.20 test -f "/work/${name}/Dockerfile"
}

frontend_install_assert_frontend_ready() {
  local frontend_dir="$1"
  local name parent

  if [[ -f "${frontend_dir}/Dockerfile" ]]; then
    return 0
  fi

  if frontend_install_in_installer; then
    name="$(basename "$frontend_dir")"
    parent="$(dirname "$frontend_dir")"
    if docker run --rm -v "${parent}:/work:ro" alpine:3.20 test -f "/work/${name}/Dockerfile"; then
      return 0
    fi
  fi

  echo "ERROR: Frontend source is not ready at ${frontend_dir}" >&2
  echo "       Expected a Dockerfile from git clone or a sibling checkout." >&2
  echo "       On the EC2 host:" >&2
  echo "         git clone https://github.com/chaturanga836/elt-frontend.git ${frontend_dir}" >&2
  echo "       Private repo: use a GitHub PAT in the URL or export GITHUB_TOKEN." >&2
  return 1
}

# Ref for checkout: ELT_FRONTEND_REF > IMAGE_TAG from .env > default branch (empty).
frontend_install_resolve_frontend_ref() {
  local env_file="${1:-}"
  local tag=""

  if [[ -n "${ELT_FRONTEND_REF:-}" ]]; then
    printf '%s' "$ELT_FRONTEND_REF"
    return 0
  fi

  if [[ -n "$env_file" && -f "$env_file" ]]; then
    tag="$(frontend_install_read_env IMAGE_TAG "$env_file")"
    if [[ -n "$tag" && "$tag" != "install" && "$tag" != "latest" ]]; then
      printf '%s' "$tag"
    fi
  fi
}

frontend_install_sync_git_checkout() {
  local frontend_dir="$1"
  local ref="$2"
  local clone_url="$3"

  git -C "$frontend_dir" remote set-url origin "$clone_url"
  if [[ -n "$ref" ]]; then
    git -C "$frontend_dir" fetch --depth 1 origin "refs/tags/${ref}:refs/tags/${ref}" 2>/dev/null \
      || git -C "$frontend_dir" fetch --depth 1 origin "$ref" \
      || return 1
    git -C "$frontend_dir" checkout --force "$ref" || return 1
  else
    local branch="master"
    git -C "$frontend_dir" fetch --depth 1 origin || return 1
    branch="$(git -C "$frontend_dir" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
    branch="${branch:-master}"
    git -C "$frontend_dir" checkout --force "$branch" 2>/dev/null \
      || git -C "$frontend_dir" checkout --force master \
      || return 1
    git -C "$frontend_dir" reset --hard "origin/${branch}" || return 1
  fi

  [[ -f "${frontend_dir}/Dockerfile" ]]
}

frontend_install_sync_git_checkout_docker() {
  local parent="$1"
  local name="$2"
  local ref="$3"
  local clone_url="$4"

  if [[ -n "$ref" ]]; then
    docker run --rm \
      -v "${parent}:/work" \
      alpine:3.20 sh -ec "
        apk add --no-cache git >/dev/null
        cd /work/${name}
        test -d .git
        git remote set-url origin '${clone_url}'
        git fetch --depth 1 origin 'refs/tags/${ref}:refs/tags/${ref}' 2>/dev/null || git fetch --depth 1 origin '${ref}'
        git checkout --force '${ref}'
        test -f Dockerfile
      "
  else
    docker run --rm \
      -v "${parent}:/work" \
      alpine:3.20 sh -ec "
        apk add --no-cache git >/dev/null
        cd /work/${name}
        test -d .git
        git remote set-url origin '${clone_url}'
        git fetch --depth 1 origin
        branch=\$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
        branch=\${branch:-master}
        git checkout --force \"\$branch\" 2>/dev/null || git checkout --force master
        git reset --hard \"origin/\$branch\"
        test -f Dockerfile
      "
  fi
}

frontend_install_remove_frontend_dir() {
  local frontend_dir="$1"
  local name parent

  name="$(basename "$frontend_dir")"
  parent="$(dirname "$frontend_dir")"

  if frontend_install_in_installer; then
    docker run --rm -v "${parent}:/work" alpine:3.20 sh -ec "rm -rf /work/${name}" || true
  elif [[ -d "$frontend_dir" ]]; then
    rm -rf "$frontend_dir"
  fi
}

# Refresh an existing elt-frontend checkout before rebuild (upgrade/install).
frontend_install_sync_existing_checkout() {
  local frontend_dir="$1"
  local ref="$2"
  local clone_url="$3"
  local name parent

  [[ -d "${frontend_dir}/.git" ]] || return 1

  echo "Updating existing frontend source at ${frontend_dir} (ref=${ref:-default branch}) ..."

  if ! frontend_install_in_installer && command -v git >/dev/null 2>&1; then
    if frontend_install_sync_git_checkout "$frontend_dir" "$ref" "$clone_url"; then
      return 0
    fi
    echo "WARN: Host git sync failed; trying docker git sync ..."
  fi

  name="$(basename "$frontend_dir")"
  parent="$(dirname "$frontend_dir")"
  frontend_install_sync_git_checkout_docker "$parent" "$name" "$ref" "$clone_url"
}

frontend_install_ensure_checkout() {
  local frontend_dir="$1"
  local env_file="${2:-}"
  local repo ref clone_url name parent clone_rc=0

  repo="${ELT_FRONTEND_REPO_HTTPS:-https://github.com/chaturanga836/elt-frontend.git}"
  ref="$(frontend_install_resolve_frontend_ref "$env_file")"
  clone_url="$(frontend_install_clone_repo_url "$repo")"

  if frontend_install_host_dockerfile_exists "$frontend_dir"; then
    if frontend_install_sync_existing_checkout "$frontend_dir" "$ref" "$clone_url"; then
      echo "Frontend source ready at ${frontend_dir}"
      return 0
    fi
    echo "WARN: Could not update existing frontend checkout — recloning ..."
    frontend_install_remove_frontend_dir "$frontend_dir"
  fi

  name="$(basename "$frontend_dir")"
  parent="$(dirname "$frontend_dir")"

  echo "Cloning elt-frontend into ${frontend_dir} ..."
  if frontend_install_in_installer; then
    if [[ -n "$ref" ]]; then
      docker run --rm \
        -v "${parent}:/work" \
        alpine:3.20 sh -ec "
          apk add --no-cache git >/dev/null
          rm -rf /work/${name}
          git clone --depth 1 -b '${ref}' '${clone_url}' /work/${name}
          test -f /work/${name}/Dockerfile
        " || clone_rc=$?
    else
      docker run --rm \
        -v "${parent}:/work" \
        alpine:3.20 sh -ec "
          apk add --no-cache git >/dev/null
          rm -rf /work/${name}
          git clone --depth 1 '${clone_url}' /work/${name}
          test -f /work/${name}/Dockerfile
        " || clone_rc=$?
    fi
    if [[ "$clone_rc" -ne 0 ]]; then
      echo "ERROR: git clone failed for ${repo}" >&2
      echo "       elt-frontend is private — clone on the host with a GitHub PAT, or export GITHUB_TOKEN." >&2
      return 1
    fi
    return 0
  fi

  if command -v git >/dev/null 2>&1; then
    mkdir -p "$parent"
    if [[ -n "$ref" ]]; then
      git clone --depth 1 -b "$ref" "$clone_url" "$frontend_dir" || clone_rc=$?
    else
      git clone --depth 1 "$clone_url" "$frontend_dir" || clone_rc=$?
    fi
    if [[ "$clone_rc" -ne 0 || ! -f "${frontend_dir}/Dockerfile" ]]; then
      echo "ERROR: git clone failed for ${repo}" >&2
      return 1
    fi
    return 0
  fi

  if [[ -n "$ref" ]]; then
    docker run --rm \
      -v "${parent}:/work" \
      alpine:3.20 sh -ec "
        apk add --no-cache git >/dev/null
        rm -rf /work/${name}
        git clone --depth 1 -b '${ref}' '${clone_url}' /work/${name}
        test -f /work/${name}/Dockerfile
      " || clone_rc=$?
  else
    docker run --rm \
      -v "${parent}:/work" \
      alpine:3.20 sh -ec "
        apk add --no-cache git >/dev/null
        rm -rf /work/${name}
        git clone --depth 1 '${clone_url}' /work/${name}
        test -f /work/${name}/Dockerfile
      " || clone_rc=$?
  fi
  if [[ "$clone_rc" -ne 0 ]]; then
    echo "ERROR: git clone failed for ${repo}" >&2
    return 1
  fi
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

  # Prefer APP_URL when wizard .env still has localhost or direct :8081 (nginx proxies /realms/).
  local app_url
  app_url="$(frontend_install_read_env APP_URL "$env_file")"
  if [[ -n "$app_url" ]]; then
    if [[ "$kc_url" == *localhost* || "$kc_url" == *127.0.0.1* || "$kc_url" == *:8081* ]]; then
      printf '%s' "$app_url"
      return
    fi
  fi

  if [[ "$kc_url" == *localhost* || "$kc_url" == *127.0.0.1* ]] && [[ -n "$api_url" ]]; then
    host="$(python3 - "$api_url" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).hostname or "")
PY
)"
    if [[ -n "$host" && "$host" != "localhost" && "$host" != "127.0.0.1" ]]; then
      kc_url="http://${host}"
    fi
  fi
  printf '%s' "$kc_url"
}

# Persist browser-facing URLs into installer .env before compose/build.
frontend_install_patch_env_public_urls() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 1

  local kc_url app_url api_url
  kc_url="$(frontend_install_resolve_kc_url "$env_file")"
  app_url="$(frontend_install_read_env APP_URL "$env_file")"
  api_url="$(frontend_install_read_env NEXT_PUBLIC_API_URL "$env_file")"

  if [[ -n "$app_url" ]]; then
    if [[ -z "$api_url" || "$api_url" == *localhost* || "$api_url" == *127.0.0.1* ]]; then
      api_url="${app_url%/}/api/v1"
    fi
  fi

  for pair in "NEXT_PUBLIC_KC_URL=${kc_url}" "NEXT_PUBLIC_API_URL=${api_url}"; do
    local key="${pair%%=*}" val="${pair#*=}"
    [[ -n "$val" ]] || continue
    if grep -q "^${key}=" "$env_file"; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >>"$env_file"
    fi
  done
  rm -f "${env_file}.bak"
  echo "Patched public URLs in ${env_file}:" >&2
  echo "  NEXT_PUBLIC_KC_URL=${kc_url}" >&2
  echo "  NEXT_PUBLIC_API_URL=${api_url}" >&2
}

frontend_install_pin_frontend_image() {
  local env_file="$1"
  local tag="$2"

  if grep -q '^FRONTEND_IMAGE=' "$env_file"; then
    sed -i.bak "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=${tag}|" "$env_file"
  else
    echo "FRONTEND_IMAGE=${tag}" >>"$env_file"
  fi
  rm -f "${env_file}.bak"
  export FRONTEND_IMAGE="$tag"
  echo "Pinned FRONTEND_IMAGE=${tag} in ${env_file}"
}

frontend_install_restore_registry_frontend_image() {
  local env_file="$1"
  local url tag image
  url="$(frontend_install_read_env REGISTRY_URL "$env_file")"
  tag="$(frontend_install_read_env IMAGE_TAG "$env_file")"
  [[ -n "$url" && -n "$tag" ]] || return 0
  image="${url}/dt-orch-frontend:${tag}"
  frontend_install_pin_frontend_image "$env_file" "$image"
  echo "Using registry frontend image: ${image}"
}

# Wizard installs must use a locally built frontend — registry images bake localhost Keycloak URLs.
frontend_install_verify_image() {
  local env_file="$1"
  local image
  image="$(frontend_install_read_env FRONTEND_IMAGE "$env_file")"
  if [[ "$image" == ghcr.io/* ]]; then
    echo "ERROR: Wizard install is using registry frontend (${image})." >&2
    echo "       Registry images ship with NEXT_PUBLIC_KC_URL=http://localhost:8081." >&2
    echo "       Re-run install after fixing the frontend build, or run:" >&2
    echo "       bash scripts/rebuild-frontend-from-source.sh --public-host YOUR_PUBLIC_IP" >&2
    return 1
  fi
  return 0
}

# Snapshot wizard .env onto the host checkout for diagnose/rebuild scripts.
frontend_install_snapshot_env_on_host() {
  local env_file="$1"
  local host_root="${ETL_DEPLOYMENT_HOST_ROOT:-}"
  [[ -f "$env_file" && -n "$host_root" ]] || return 0
  local dest="${host_root}/.install.state.env"
  if frontend_install_in_installer; then
    docker run --rm -v "${host_root}:/work:rw" alpine:3.20 sh -ec "
      cat > /work/.install.state.env
    " <"$env_file"
  else
    cp "$env_file" "$dest"
  fi
  echo "Saved install .env snapshot: ${dest}"
}

# Build image and pin FRONTEND_IMAGE in env on success only.
frontend_install_build() {
  local root_dir="$1"
  local env_file="$2"
  local tag="${3:-dt-orch-frontend:install}"
  local frontend_dir=""

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

  if ! frontend_dir="$(frontend_install_resolve_frontend_dir "$root_dir")"; then
    return 1
  fi

  if ! frontend_install_ensure_checkout "$frontend_dir" "$env_file"; then
    return 1
  fi

  if ! frontend_install_assert_frontend_ready "$frontend_dir"; then
    return 1
  fi

  echo "Building install frontend as ${tag}"
  echo "  source=${frontend_dir}"
  echo "  NEXT_PUBLIC_KC_URL=${kc_url}"
  echo "  NEXT_PUBLIC_API_URL=${api_url}"

  # Inside the wizard, docker build PATH is prepared by the *client* filesystem.
  # Host paths like /home/ubuntu/elt-frontend are not visible inside the container
  # even though the daemon can mount them — stream the context from the host instead.
  local build_args=(
    -t "$tag"
    --build-arg "NEXT_PUBLIC_API_URL=${api_url}"
    --build-arg "NEXT_PUBLIC_BUILD_ID=${build_id}"
    --build-arg "NEXT_PUBLIC_KC_URL=${kc_url}"
    --build-arg "NEXT_PUBLIC_KC_REALM=${kc_realm}"
    --build-arg "NEXT_PUBLIC_KC_CLIENT_ID=${kc_client}"
  )
  if frontend_install_in_installer; then
    if ! docker run --rm -v "${frontend_dir}:/src:ro" alpine:3.20 \
      tar -C /src -cf - . \
      | docker build "${build_args[@]}" -; then
      echo "ERROR: Frontend docker build failed." >&2
      return 1
    fi
  elif ! docker build "${build_args[@]}" "$frontend_dir"; then
    echo "ERROR: Frontend docker build failed." >&2
    return 1
  fi

  frontend_install_pin_frontend_image "$env_file" "$tag"
}

# Registry FRONTEND_IMAGE bakes localhost Keycloak URLs — rebuild like install.sh before compose up.
frontend_install_ensure_upgrade_frontend() {
  local root_dir="$1"
  local env_file="$2"
  local tag="${3:-dt-orch-frontend:install}"

  frontend_install_patch_env_public_urls "$env_file"

  if [[ "${UPGRADE_REBUILD_FRONTEND:-true}" != "true" ]]; then
    echo "UPGRADE_REBUILD_FRONTEND=false — skipping frontend rebuild (Keycloak login may break on registry images)."
    return 0
  fi

  if frontend_install_build "$root_dir" "$env_file" "$tag"; then
    echo "Frontend rebuilt for upgrade (${tag}) with public Keycloak URLs."
    return 0
  fi

  if docker image inspect "$tag" >/dev/null 2>&1; then
    frontend_install_pin_frontend_image "$env_file" "$tag"
    echo "Using existing ${tag} (registry image would redirect login to localhost:8081)."
    return 0
  fi

  echo "ERROR: Frontend rebuild failed and no local ${tag} image exists." >&2
  echo "  Registry images ship with NEXT_PUBLIC_KC_URL=http://localhost:8081." >&2
  echo "  Recovery: bash scripts/fresh-install.sh --yes  (complete Install UI wizard)" >&2
  return 1
}
