#!/usr/bin/env bash
# Clean reinstall — tear down platform + wizard state, then restart the setup wizard.
# Use when a previous install left bad credentials, volumes, or partial state.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="${STATE_DIR:-/opt/etl-deployment-state}"
ASSUME_YES=false

usage() {
  cat <<'EOF'
Usage: reinstall.sh [OPTIONS]

Tear down the DT Orch platform and setup wizard, remove persisted volumes/state,
then start a fresh setup wizard (./scripts/setup-ui.sh).

Options:
  --yes, -y     Skip confirmation prompt
  -h, --help    Show this help

Environment:
  STATE_DIR     Installer state directory (default: /opt/etl-deployment-state)

After the wizard restarts, open the printed URL and run Install again.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ "$ASSUME_YES" != true ]]; then
  cat <<EOF
This will:
  - Stop and remove all DT Orch platform containers (profile: full)
  - Delete Postgres and other platform volumes (all application data)
  - Stop the setup wizard container
  - Clear installer state (${STATE_DIR} inside Docker volume)

Continue? [y/N]
EOF
  read -r reply
  case "${reply:-}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

echo "Stopping platform stack..."
ENV_FILE_ARG=()
if [[ -f "${STATE_DIR}/.env" ]]; then
  ENV_FILE_ARG=(--env-file "${STATE_DIR}/.env")
elif [[ -f "${ROOT_DIR}/.env" ]]; then
  ENV_FILE_ARG=(--env-file "${ROOT_DIR}/.env")
fi

docker compose -f compose/monolith.yml "${ENV_FILE_ARG[@]}" --profile full down -v --remove-orphans 2>/dev/null || true

echo "Stopping setup wizard..."
INSTALLER_COMPOSE=(-f compose/installer.yml)
if [[ -f "${ROOT_DIR}/../etl-back/Dockerfile" ]]; then
  INSTALLER_COMPOSE+=(-f compose/installer.dev.yml)
fi
docker compose "${INSTALLER_COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true

echo "Removing installer state volume (if present)..."
for vol in etl-deployment_installer_state compose_installer_state installer_state; do
  docker volume rm "$vol" 2>/dev/null || true
done

echo ""
echo "Clean slate ready. Starting setup wizard..."
echo ""
exec "${ROOT_DIR}/scripts/setup-ui.sh"
