#!/usr/bin/env bash
# Build and push DT Orch images to a container registry (manual release).
# Usage:
#   export REGISTRY=ghcr.io/your-org
#   export VERSION=v1.0.0
#   ./scripts/release/build-and-push.sh all|api|frontend|infra|scraper
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGISTRY="${REGISTRY:?Set REGISTRY e.g. ghcr.io/your-org}"
VERSION="${VERSION:?Set VERSION e.g. v1.0.0}"
TAG="${VERSION#v}"

login_registry() {
  if [[ -n "${REGISTRY_USER:-}" && -n "${REGISTRY_PASSWORD:-}" ]]; then
    echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin
  fi
}

push_image() {
  local local_name="$1"
  local remote_name="$2"
  docker tag "$local_name" "${REGISTRY}/${remote_name}:${VERSION}"
  docker tag "$local_name" "${REGISTRY}/${remote_name}:${TAG}"
  docker tag "$local_name" "${REGISTRY}/${remote_name}:latest"
  docker push "${REGISTRY}/${remote_name}:${VERSION}"
  docker push "${REGISTRY}/${remote_name}:${TAG}"
  docker push "${REGISTRY}/${remote_name}:latest"
  echo "Pushed ${REGISTRY}/${remote_name}:${VERSION}"
}

build_api() {
  docker build -t "dt-orch-api:local" "${ROOT}/../etl-back"
  push_image "dt-orch-api:local" "dt-orch-api"
}

build_frontend() {
  docker build -t "dt-orch-frontend:local" "${ROOT}/../elt-frontend" \
    --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost/api/v1}" \
    --build-arg "NEXT_PUBLIC_BUILD_ID=${VERSION}" \
    --build-arg "NEXT_PUBLIC_KC_URL=${NEXT_PUBLIC_KC_URL:-http://localhost:8081}" \
    --build-arg "NEXT_PUBLIC_KC_REALM=${NEXT_PUBLIC_KC_REALM:-workspace-realm}" \
    --build-arg "NEXT_PUBLIC_KC_CLIENT_ID=${NEXT_PUBLIC_KC_CLIENT_ID:-workspace-web}"
  push_image "dt-orch-frontend:local" "dt-orch-frontend"
}

build_infra() {
  docker build -t "baas-infra:local" -f "${ROOT}/../platform-infra-repo/infra-service/Dockerfile" \
    "${ROOT}/../platform-infra-repo"
  push_image "baas-infra:local" "baas-infra"
}

build_scraper() {
  docker build -t "dt-orch-scraper:local" "${ROOT}/scraper-service"
  push_image "dt-orch-scraper:local" "dt-orch-scraper"
}

TARGET="${1:-all}"
login_registry

case "$TARGET" in
  api) build_api ;;
  frontend) build_frontend ;;
  infra) build_infra ;;
  scraper) build_scraper ;;
  all)
    build_api
    build_frontend
    build_infra
    build_scraper
    ;;
  *)
    echo "Unknown target: $TARGET (api|frontend|infra|scraper|all)"
    exit 1
    ;;
esac

echo "Done. Set REGISTRY_URL=${REGISTRY} IMAGE_TAG=${VERSION} in customer .env"
