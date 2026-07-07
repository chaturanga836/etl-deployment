#!/usr/bin/env bash
# Set a GHCR container package to public (no customer GitHub token required to pull).
# Usage:
#   export GH_TOKEN=ghp_...   # or use: gh auth login
#   ./scripts/release/set-package-public.sh dt-orch-api [github-owner]
set -euo pipefail

PACKAGE="${1:?Package name required (e.g. dt-orch-api)}"
OWNER="${2:-${GITHUB_REPOSITORY_OWNER:-chaturanga836}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../../.github/scripts/set-package-public.sh" "${PACKAGE}" "${OWNER}"
