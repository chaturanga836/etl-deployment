#!/usr/bin/env bash
# Publish DT Orch images as public GHCR packages (shared release workflow step).
# Customers pull without a GitHub token; git source repos stay private.
set -euo pipefail

PACKAGE="${1:?Package name (e.g. dt-orch-api)}"
OWNER="${2:?GitHub owner/org}"

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
  echo "GHCR package ${OWNER}/${PACKAGE} is already public."
  exit 0
fi

gh api --method PATCH "${API_PATH}" -f visibility=public
echo "GHCR package ${OWNER}/${PACKAGE} is public."
