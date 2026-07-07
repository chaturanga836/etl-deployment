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

resolve_package_api() {
  if gh api "/orgs/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
    echo "/orgs/${OWNER}/packages/container/${PACKAGE}"
  elif gh api "/users/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
    echo "/users/${OWNER}/packages/container/${PACKAGE}"
  elif gh api "/user/packages/container/${PACKAGE}" &>/dev/null; then
    echo "/user/packages/container/${PACKAGE}"
  else
    echo "ERROR: GHCR package ${OWNER}/${PACKAGE} not found." >&2
    echo "Tried /orgs/, /users/${OWNER}/, and /user/ package APIs." >&2
    return 1
  fi
}

API_PATH="$(resolve_package_api)"

VISIBILITY="$(gh api "${API_PATH}" --jq '.visibility' 2>/dev/null || echo private)"
if [ "${VISIBILITY}" = "public" ]; then
  echo "Package ${OWNER}/${PACKAGE} is already public on GHCR."
  exit 0
fi

gh api --method PATCH "${API_PATH}" -f visibility=public
echo "Package ${OWNER}/${PACKAGE} is now public on GHCR."
