#!/usr/bin/env bash
# One-time vendor fix: make all DT Orch release images publicly pullable (no customer PAT).
# Git source repos stay private; protection is in compiled container images (see docs/CODE_PROTECTION.md).
#
# Usage:
#   gh auth login
#   ./scripts/release/set-packages-public.sh [github-owner]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OWNER="${1:-chaturanga836}"

for pkg in dt-orch-api dt-orch-frontend baas-infra dt-orch-scraper; do
  echo "Setting ${pkg} to public..."
  "$ROOT/scripts/release/set-package-public.sh" "$pkg" "$OWNER"
done

echo ""
echo "Done. Customers can pull without docker login:"
echo "  docker pull ghcr.io/${OWNER}/dt-orch-api:v1.0.0"
