#!/usr/bin/env bash
# Clean reinstall — tear down platform + wizard state, build fixed API, restart wizard.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="${STATE_DIR:-/opt/etl-deployment-state}"
ETL_BACK="${ETL_BACK:-$ROOT_DIR/../etl-back}"
ETL_BACK_REPO="${ETL_BACK_REPO:-git@github.com:chaturanga836/etl-back.git}"
ETL_BACK_REPO_HTTPS="${ETL_BACK_REPO_HTTPS:-https://github.com/chaturanga836/etl-back.git}"
API_TAG="${LOCAL_API_IMAGE:-dt-orch-api:fixed}"
# End-user installs pull public GHCR images only. Vendor devs may pass --vendor-build-api.
ASSUME_YES=false
SKIP_API_BUILD=true
VENDOR_BUILD_API=false

usage() {
  cat <<'EOF'
Usage: reinstall.sh [OPTIONS]

Tear down the DT Orch platform and setup wizard, remove persisted volumes/state,
then start the setup wizard (./scripts/setup-ui.sh).

End users only need etl-deployment + public GHCR images (see VERSION).

Options:
  --yes, -y             Skip confirmation prompt
  --vendor-build-api    Vendor only: clone/build etl-back as dt-orch-api:fixed
  --skip-api-build      Default — use registry images from VERSION
  -h, --help          Show this help

Environment:
  STATE_DIR           Installer state directory (default: /opt/etl-deployment-state)
  ETL_BACK            Path to etl-back checkout (default: ../etl-back)
  ETL_BACK_REPO       Git SSH URL to clone (default: git@github.com:.../etl-back.git)
  ETL_BACK_REPO_HTTPS HTTPS fallback if SSH clone fails (use PAT in URL if needed)
  LOCAL_API_IMAGE     Tag for rebuilt API (default: dt-orch-api:fixed)

After the wizard restarts:
  1. Open the printed URL (port 3000)
  2. Complete all wizard steps
  3. Click Install on the Confirm step
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=true; shift ;;
    --vendor-build-api) VENDOR_BUILD_API=true; SKIP_API_BUILD=false; shift ;;
    --skip-api-build) SKIP_API_BUILD=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

clone_etl_back() {
  if [[ -f "${ETL_BACK}/Dockerfile" ]]; then
    return 0
  fi
  rm -rf "${ETL_BACK}"
  mkdir -p "$(dirname "$ETL_BACK")"
  echo "Cloning etl-back into ${ETL_BACK} (SSH) ..."
  if git clone "$ETL_BACK_REPO" "$ETL_BACK" 2>/dev/null; then
    return 0
  fi
  echo "SSH clone failed — trying HTTPS (private repo needs a PAT in the URL) ..."
  if git clone "$ETL_BACK_REPO_HTTPS" "$ETL_BACK" 2>/dev/null; then
    return 0
  fi
  cat <<EOF >&2

ERROR: Could not clone etl-back (private repo).

On this server, use ONE of:

  1) SSH deploy key (recommended on EC2):
     ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
     cat ~/.ssh/id_ed25519.pub   # add as deploy key on github.com/chaturanga836/etl-back
     ETL_BACK_REPO=git@github.com:chaturanga836/etl-back.git ./scripts/reinstall.sh --yes

  2) Personal access token (read:repo):
     git clone https://<GITHUB_PAT>@github.com/chaturanga836/etl-back.git ~/etl-back
     cd ~/etl-deployment && ./scripts/reinstall.sh --yes

  3) Build on your laptop and load the image here:
     docker build --build-arg SOURCE_PROTECTION=1 -t dt-orch-api:fixed .
     docker save dt-orch-api:fixed | gzip > api-fixed.tar.gz
     scp api-fixed.tar.gz ubuntu@<host>:~
     gunzip -c ~/api-fixed.tar.gz | docker load
     ./scripts/reinstall.sh --yes --skip-api-build

EOF
  return 1
}

if [[ "$ASSUME_YES" != true ]]; then
  cat <<EOF
This will:
  - Stop and remove all DT Orch platform containers (profile: full)
  - Delete Postgres, installer state, and other platform volumes
  - Remove per-org Centrifugo / workspace data-plane containers
  - Restart the setup wizard

Prefer: ./scripts/fresh-install.sh --yes  (also runs git pull)

Continue? [y/N]
EOF
  read -r reply
  case "${reply:-}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

CLEAN_ARGS=()
[[ "$ASSUME_YES" == true ]] && CLEAN_ARGS+=(--yes)
"${ROOT_DIR}/scripts/clean-platform.sh" "${CLEAN_ARGS[@]}"

if [[ "$SKIP_API_BUILD" != true ]] || [[ "$VENDOR_BUILD_API" == true ]]; then
  if docker image inspect "$API_TAG" >/dev/null 2>&1; then
    echo "Using existing image: ${API_TAG}"
  elif clone_etl_back; then
    echo "Building fixed API image as ${API_TAG} (10–15 min) ..."
    docker build --build-arg SOURCE_PROTECTION=1 -t "$API_TAG" "$ETL_BACK"
    echo "Fixed API image ready: ${API_TAG}"
  else
    exit 1
  fi
else
  echo "Skipping API rebuild (--skip-api-build)."
fi

echo ""
echo "Clean slate ready. Starting setup wizard..."
echo ""
exec "${ROOT_DIR}/scripts/setup-ui.sh"
