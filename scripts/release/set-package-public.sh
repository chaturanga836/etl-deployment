#!/usr/bin/env bash
# Set a GHCR container package to public (no customer GitHub token required to pull).
# Usage:
#   export GH_TOKEN=ghp_...   # or use: gh auth login
#   ./scripts/release/set-package-public.sh dt-orch-api [github-owner]
set -euo pipefail

PACKAGE="${1:?Package name required (e.g. dt-orch-api)}"
OWNER="${2:-${GITHUB_REPOSITORY_OWNER:-chaturanga836}}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required."
  exit 1
fi

if gh api "/orgs/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
  gh api --method PATCH "/orgs/${OWNER}/packages/container/${PACKAGE}" -f visibility=public
else
  gh api --method PATCH "/user/packages/container/${PACKAGE}" -f visibility=public
fi

echo "Package ${OWNER}/${PACKAGE} is now public on GHCR."
