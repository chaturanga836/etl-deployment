#!/usr/bin/env bash
# Publish DT Orch images as public GHCR packages (shared release workflow step).
# Customers pull without a GitHub token; git source repos stay private.
set -euo pipefail

PACKAGE="${1:?Package name (e.g. dt-orch-api)}"
OWNER="${2:?GitHub owner/org}"

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

  echo "ERROR: GitHub CLI (gh) not found in PATH." >&2
  echo "Install gh or set GH_BIN to the gh executable path." >&2
  return 127
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
  echo "GHCR package ${OWNER}/${PACKAGE} is already public."
  exit 0
fi

gh_cmd api --method PATCH "${API_PATH}" -f visibility=public
echo "GHCR package ${OWNER}/${PACKAGE} is public."
