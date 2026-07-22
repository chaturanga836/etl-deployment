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
  - Monolith stack (api, worker, postgres, mysql, mongo, redis, keycloak, frontend, nginx, infra, scraper)
  - Setup wizard (dt-orch-installer)
  - Related Docker volumes and dt-orch networks
  - Dead/unused Docker images, volumes, networks, and build cache
    (images still used by running containers such as Jenkins/Dozzle are kept)

Does NOT remove: Jenkins, Dozzle, or other unrelated running containers.

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
Also prunes unused Docker images, volumes, networks, and build cache.
Jenkins and Dozzle are left running (their images stay if those containers are up).

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
# Include workspace-mysql / workspace-mongo — those services are not on the `full` profile.
docker compose -f compose/monolith.yml "${ENV_ARG[@]}" \
  --profile full --profile workspace-mysql --profile workspace-mongo \
  down -v --remove-orphans 2>/dev/null || true

echo "=== Stopping setup wizard ==="
INSTALLER_COMPOSE=(-f compose/installer.yml)
[[ -f "$ROOT_DIR/../etl-back/Dockerfile" ]] && INSTALLER_COMPOSE+=(-f compose/installer.dev.yml)
docker compose "${INSTALLER_COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true

echo "=== Removing leftover DT Orch containers ==="
for name in \
  dt-orch-api dt-orch-worker dt-orch-frontend dt-orch-scraper dt-orch-installer \
  elt-proxy elt-keycloak elt-postgres elt-mysql elt-mongo elt-redis elt-ollama \
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
# Named volumes from compose (mysql_data / mongo_data) if project prefix differs
docker volume ls -q | grep -E '(mysql_data|mongo_data|postgres_data|minio_data|infra_instances)$' \
  | xargs -r docker volume rm 2>/dev/null || true

echo "=== Removing DT Orch networks ==="
docker network ls -q --filter name=dt-orch | xargs -r docker network rm 2>/dev/null || true
docker network rm data-plane-net 2>/dev/null || true
docker network rm elt-net 2>/dev/null || true

rm -f "${ROOT_DIR}/.frontend-rebuild.env"
rm -f "${ROOT_DIR}/.installer-state.env"
rm -f "${ROOT_DIR}/.env.from-installer"
rm -f "${ROOT_DIR}/.install.state.env"
# Stale frontend source/image can serve an old UI after fresh install.
FRONTEND_SIBLING="$(dirname "$ROOT_DIR")/elt-frontend"
if [[ -d "$FRONTEND_SIBLING" ]]; then
  echo "Removing stale frontend source checkout: ${FRONTEND_SIBLING}"
  FE_PARENT="$(dirname "$FRONTEND_SIBLING")"
  FE_NAME="$(basename "$FRONTEND_SIBLING")"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker run --rm -v "${FE_PARENT}:/work" alpine:3.20 sh -ec "rm -rf /work/${FE_NAME}" || true
  else
    rm -rf "$FRONTEND_SIBLING" 2>/dev/null || sudo rm -rf "$FRONTEND_SIBLING" 2>/dev/null || true
  fi
  if [[ -d "$FRONTEND_SIBLING" ]]; then
    echo "WARN: Could not remove ${FRONTEND_SIBLING} — run: sudo rm -rf ${FRONTEND_SIBLING}" >&2
  fi
fi
if docker image inspect dt-orch-frontend:install >/dev/null 2>&1; then
  echo "Removing stale frontend install image: dt-orch-frontend:install"
  docker rmi -f dt-orch-frontend:install 2>/dev/null || true
fi
# Stale host .env can poison upgrade.sh / compose after a wipe — wizard regenerates state.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  echo "Removing stale ${ROOT_DIR}/.env (wizard will recreate installer state)"
  rm -f "${ROOT_DIR}/.env"
fi

# Free disk for the next frontend/on-host build. Images still referenced by
# running containers (Jenkins, Dozzle, etc.) are kept; everything else goes.
echo "=== Pruning dead Docker images, volumes, networks, build cache ==="
docker container prune -f 2>/dev/null || true
docker network prune -f 2>/dev/null || true
docker volume prune -f 2>/dev/null || true
docker image prune -af 2>/dev/null || true
docker builder prune -af 2>/dev/null || true
if command -v docker >/dev/null 2>&1; then
  echo "Disk after prune:"
  docker system df 2>/dev/null || true
  df -h / 2>/dev/null || true
fi

echo ""
echo "Cleanup complete. Remaining containers:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
echo ""
echo "Next: ./scripts/fresh-install.sh --yes   (or ./scripts/setup-ui.sh -d if already clean)"
