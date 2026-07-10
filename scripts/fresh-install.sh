#!/usr/bin/env bash
# Standard recovery: wipe DT Orch Docker state and run the setup wizard from scratch.
# Use whenever install is broken — do not patch with manual bootstrap or host-side fixes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ASSUME_YES=false
SKIP_PULL=false

usage() {
  cat <<'EOF'
Usage: fresh-install.sh [OPTIONS]

Official recovery when any part of the platform is broken:
  1. git pull (latest etl-deployment fixes)
  2. ./scripts/clean-platform.sh — remove all DT Orch containers, volumes, networks
  3. ./scripts/setup-ui.sh — start the Install UI

Then complete every wizard step and click Install (no manual .env or bootstrap scripts).

Options:
  --yes, -y       Skip all confirmation prompts
  --skip-pull     Do not run git pull
  -h, --help      Show help

EC2 security group: TCP 3000 (wizard), TCP 80 (platform after install).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=true; shift ;;
    --skip-pull) SKIP_PULL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ "$SKIP_PULL" != true ]] && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "=== Pulling latest etl-deployment ==="
  if ! git -C "$ROOT_DIR" pull --ff-only; then
    echo "WARN: git pull failed (local changes or diverged branch). Continuing with checkout on disk." >&2
  fi
fi

CLEAN_ARGS=()
[[ "$ASSUME_YES" == true ]] && CLEAN_ARGS+=(--yes)
"${ROOT_DIR}/scripts/clean-platform.sh" "${CLEAN_ARGS[@]}"

echo ""
echo "=== Starting setup wizard ==="
export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
exec "${ROOT_DIR}/scripts/setup-ui.sh" -d
