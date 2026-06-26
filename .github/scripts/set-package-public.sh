# Publish DT Orch images as public GHCR packages (shared release workflow step).
# Customers pull without a GitHub token; git source repos stay private.
set -euo pipefail

PACKAGE="${1:?Package name (e.g. dt-orch-api)}"
OWNER="${2:?GitHub owner/org}"

if gh api "/orgs/${OWNER}/packages/container/${PACKAGE}" &>/dev/null; then
  gh api --method PATCH "/orgs/${OWNER}/packages/container/${PACKAGE}" -f visibility=public
else
  gh api --method PATCH "/user/packages/container/${PACKAGE}" -f visibility=public
fi

echo "GHCR package ${OWNER}/${PACKAGE} is public."
