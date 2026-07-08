#!/usr/bin/env bash
# Verify all public release images exist on GHCR for the tag in VERSION.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION_FILE="${1:-$ROOT/VERSION}"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: VERSION not found: $VERSION_FILE"
  exit 1
fi

line="$(python3 "$ROOT/scripts/release/version_lib.py" show "$VERSION_FILE")"
REGISTRY="$(echo "$line" | awk '{print $2}')"
TAG="$(echo "$line" | awk '{print $3}')"
IMAGES=(dt-orch-api dt-orch-frontend baas-infra dt-orch-scraper)

echo "Checking ${REGISTRY} images for tag ${TAG}..."
failed=0
for name in "${IMAGES[@]}"; do
  ref="${REGISTRY}/${name}:${TAG}"
  if docker manifest inspect "$ref" >/dev/null 2>&1; then
    echo "  OK  $ref"
  else
    echo "  MISSING  $ref"
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo ""
  echo "Release incomplete — publish missing images before end-user install."
  echo "API: tag etl-back v${TAG#v} and push (GitHub Actions release workflow)."
  echo "Others: re-tag from previous release if unchanged:"
  echo "  docker pull ${REGISTRY}/dt-orch-frontend:v1.0.1"
  echo "  docker tag  ${REGISTRY}/dt-orch-frontend:v1.0.1 ${REGISTRY}/dt-orch-frontend:${TAG}"
  echo "  docker push ${REGISTRY}/dt-orch-frontend:${TAG}"
  exit 1
fi

echo "All release images are available."
