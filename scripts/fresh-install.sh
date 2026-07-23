#!/usr/bin/env bash
# Fresh EC2 install — wipe all DT Orch Docker state and start the Install UI.
# Canonical path for first-time install AND any broken install. No mid-flight quick fixes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ASSUME_YES=false
SKIP_PULL=false

usage() {
  cat <<'EOF'
Usage: fresh-install.sh [OPTIONS]

Official install / recovery (same flow for new EC2 or broken platform):

  1. git pull
  2. clean-platform.sh  — remove ALL DT Orch containers/volumes/networks,
                          plus dead/unused images, volumes, networks, build cache
  3. setup-ui.sh        — start Install UI on port 3000

Then in the browser: complete every wizard step → Install → login.

Do NOT use manual bootstrap, pip install on host, rebuild-frontend mid-install,
or hand-edited .env — fix code in this repo, then run this script again.

Options:
  --yes, -y       Skip confirmation prompts
  --skip-pull     Do not run git pull
  -h, --help      Show help

EC2 security group: inbound TCP 3000 (wizard), TCP 80 (platform).
VERSION must match published GHCR images (see VERSION file).
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

cat <<'EOF'

================================================================
  DT Orch — fresh install (clean slate)
================================================================
  • Removes platform + wizard + Postgres data + installer state
  • Prunes dead/unused Docker images, volumes, networks, and build cache
  • Leaves Jenkins, Dozzle, and other non-DT-Orch running containers alone
  • After wizard starts: open http://<EC2-IP>:3000 and click Install
  • Studio UI is pulled from GHCR (CI-built). Baked localhost URLs are rewritten
    to the page origin in the browser — no elt-frontend clone on this host
================================================================

EOF

if [[ "$SKIP_PULL" != true ]] && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "=== Pulling latest etl-deployment ==="
  if ! git -C "$ROOT_DIR" pull --ff-only; then
    echo "WARN: git pull failed — continuing with files on disk." >&2
  fi
fi

CLEAN_ARGS=()
[[ "$ASSUME_YES" == true ]] && CLEAN_ARGS+=(--yes)
"${ROOT_DIR}/scripts/clean-platform.sh" "${CLEAN_ARGS[@]}"

echo ""
echo "=== Starting setup wizard ==="
export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"
exec "${ROOT_DIR}/scripts/setup-ui.sh" -d
