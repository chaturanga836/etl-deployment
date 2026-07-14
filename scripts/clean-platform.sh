#!/usr/bin/env bash
# Remove all DT Orch platform + wizard containers/volumes/networks (keeps Jenkins, Dozzle, etc.).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ASSUME_YES=false

usage() {
  cat <<'EOF'
Usage: clean-platform.sh [OPTIONS]

Stops and removes:
  - Monolith stack (api, worker, postgres, redis, keycloak, frontend, nginx, infra, scraper)
  - Setup wizard (dt-orch-installer)
  - Related Docker volumes and dt-orch networks

Does NOT remove: Jenkins, Dozzle, or other unrelated containers.

Options:
  --yes, -y     Skip confirmation
  -h, --help    Show help
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
  cat <<'EOF'
This removes ALL DT Orch platform data (Postgres volumes, installer state, etc.).
Jenkins and Dozzle are left running.

Continue? [y/N]
EOF
  read -r reply
  case "${reply:-}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

export ETL_DEPLOYMENT_HOST_ROOT="${ETL_DEPLOYMENT_HOST_ROOT:-$ROOT_DIR}"

echo "=== Stopping monolith stack ==="
STATE_VOL=$(docker volume inspect etl-deployment_installer_state --format '{{ .Mountpoint }}' 2>/dev/null || true)
ENV_ARG=()
if [[ -n "$STATE_VOL" && -f "$STATE_VOL/.env" ]]; then
  ENV_ARG=(--env-file "$STATE_VOL/.env")
fi
docker compose -f compose/monolith.yml "${ENV_ARG[@]}" --profile full down -v --remove-orphans 2>/dev/null || true

echo "=== Stopping setup wizard ==="
INSTALLER_COMPOSE=(-f compose/installer.yml)
[[ -f "$ROOT_DIR/../etl-back/Dockerfile" ]] && INSTALLER_COMPOSE+=(-f compose/installer.dev.yml)
docker compose "${INSTALLER_COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true

echo "=== Removing leftover DT Orch containers ==="
for name in \
  dt-orch-api dt-orch-worker dt-orch-frontend dt-orch-scraper dt-orch-installer \
  elt-proxy elt-keycloak elt-postgres elt-redis \
  baas-infra-service \
  platform-shared-minio-storage platform-shared-centrifugo; do
  docker rm -f "$name" 2>/dev/null || true
done

echo "=== Removing per-org / per-workspace data-plane containers ==="
docker ps -a --format '{{.Names}}' | grep -E '^(org-[0-9]+-.*-broker|ws-[0-9]+-.*-(db|storage)|platform-shared-)' \
  | xargs -r docker rm -f 2>/dev/null || true

echo "=== Removing DT Orch volumes ==="
docker volume ls -q | grep -E '^(dt-orch_|etl-deployment_)' | xargs -r docker volume rm 2>/dev/null || true
docker volume ls -q | grep -E 'installer_state$' | xargs -r docker volume rm 2>/dev/null || true

echo "=== Removing DT Orch networks ==="
docker network ls -q --filter name=dt-orch | xargs -r docker network rm 2>/dev/null || true
docker network rm data-plane-net 2>/dev/null || true

rm -f "${ROOT_DIR}/.frontend-rebuild.env"

echo ""
echo "Cleanup complete. Remaining containers:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
echo ""
echo "Next: ./scripts/fresh-install.sh --yes   (or ./scripts/setup-ui.sh -d if already clean)"
