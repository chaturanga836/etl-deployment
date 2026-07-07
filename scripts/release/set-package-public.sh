#!/usr/bin/env bash
# Set a GHCR container package to public (no customer GitHub token required to pull).
# Usage:
#   export GH_TOKEN=ghp_...   # or use: gh auth login
#   ./scripts/release/set-package-public.sh dt-orch-api [github-owner]
set -euo pipefail

PACKAGE="${1:?Package name required (e.g. dt-orch-api)}"
OWNER="${2:-${GITHUB_REPOSITORY_OWNER:-chaturanga836}}"

gh_cmd() {
  if command -v gh >/dev/null 2>&1; then
    gh "$@"
    return
  fi

  local candidate
  for candidate in \
    "${GH_BIN:-}" \
    "/c/Program Files/GitHub CLI/gh.exe" \
    "/mnt/c/Program Files/GitHub CLI/gh.exe" \
    "${PROGRAMFILES:-}/GitHub CLI/gh.exe" \
    "${ProgramFiles:-}/GitHub CLI/gh.exe"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
      "${candidate}" "$@"
      return
    fi
  done

  echo "ERROR: GitHub CLI (gh) is required."
  exit 1
}

resolve_package_api() {
  # No leading slash: Git Bash on Windows rewrites /orgs/... to a filesystem path.
  if gh_cmd api "orgs/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
    echo "orgs/${OWNER}/packages/container/${PACKAGE}"
  elif gh_cmd api "users/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
    echo "users/${OWNER}/packages/container/${PACKAGE}"
  elif gh_cmd api "user/packages/container/${PACKAGE}" &>/dev/null; then
    echo "user/packages/container/${PACKAGE}"
  else
    echo "ERROR: GHCR package ${OWNER}/${PACKAGE} not found." >&2
    echo "Tried /orgs/, /users/${OWNER}/, and /user/ package APIs." >&2
    echo "Ensure gh is authenticated with read:packages and write:packages scopes." >&2
    return 1
  fi
}

API_PATH="$(resolve_package_api)"

VISIBILITY="$(gh_cmd api "${API_PATH}" --jq '.visibility' 2>/dev/null || echo private)"
if [ "${VISIBILITY}" = "public" ]; then
  echo "Package ${OWNER}/${PACKAGE} is already public on GHCR."
  exit 0
fi

gh_cmd api --method PATCH "${API_PATH}" -f visibility=public
echo "Package ${OWNER}/${PACKAGE} is now public on GHCR."
