#!/usr/bin/env bash
# Bump VERSION, commit, and tag all DT Orch repos for an automated platform release.
#
# Used by .github/workflows/platform-release.yml (workflow_dispatch / repository_dispatch).
# Requires GH_TOKEN with repo + workflow scope across app repos (RELEASE_PAT in CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION_FILE="$ROOT/VERSION"
VERSION_LIB="$ROOT/scripts/release/version_lib.py"

BUMP="patch"
EXPLICIT_VERSION=""
DRY_RUN=false
SKIP_COMMIT=false

RELEASE_REPOS=(
  etl-back
  elt-frontend
  platform-infra-repo
  etl-deployment
)

usage() {
  cat <<'EOF'
Usage: platform-release.sh [OPTIONS]

Options:
  --bump patch|minor|major   Semver bump when --version is omitted (default: patch)
  --version VERSION          Exact platform version, e.g. 1.0.1 (no leading v)
  --dry-run                  Print actions without writing, committing, or tagging
  --skip-commit              Tag repos only (VERSION already committed on this ref)
  -h, --help                 Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump) BUMP="$2"; shift 2 ;;
    --version) EXPLICIT_VERSION="${2#v}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --skip-commit) SKIP_COMMIT=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: VERSION file not found at $VERSION_FILE"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required for platform-release.sh"
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN (or RELEASE_PAT) must be set"
  exit 1
fi

OWNER="${GITHUB_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}"
if [[ -z "$OWNER" ]]; then
  OWNER="$(gh api user --jq .login)"
fi

if [[ -n "$EXPLICIT_VERSION" ]]; then
  NEW_PLATFORM="$EXPLICIT_VERSION"
else
  NEW_PLATFORM="$(python3 "$VERSION_LIB" bump "$VERSION_FILE" --kind "$BUMP")"
fi

NEW_TAG="v${NEW_PLATFORM}"
CURRENT_PLATFORM="$(python3 "$VERSION_LIB" show "$VERSION_FILE" | cut -f1)"
CURRENT_TAG="v${CURRENT_PLATFORM}"

echo "Platform release: ${CURRENT_TAG} -> ${NEW_TAG} (owner: ${OWNER})"

if [[ "$NEW_TAG" == "$CURRENT_TAG" && "$SKIP_COMMIT" == false ]]; then
  echo "ERROR: Refusing to release ${NEW_TAG}; bump VERSION or pass --version"
  exit 1
fi

tag_exists() {
  local repo="$1"
  local tag="$2"
  gh api "repos/${OWNER}/${repo}/git/ref/tags/${tag}" >/dev/null 2>&1
}

create_tag_on_default_branch() {
  local repo="$1"
  local tag="$2"

  if tag_exists "$repo" "$tag"; then
    echo "Skip tag ${tag} on ${repo} (already exists)"
    return 0
  fi

  local default_branch
  default_branch="$(gh api "repos/${OWNER}/${repo}" --jq .default_branch)"
  local sha
  sha="$(gh api "repos/${OWNER}/${repo}/git/ref/heads/${default_branch}" --jq .object.sha)"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] tag ${OWNER}/${repo}@${default_branch} (${sha:0:7}) -> ${tag}"
    return 0
  fi

  gh api "repos/${OWNER}/${repo}/git/refs" \
    -f ref="refs/tags/${tag}" \
    -f sha="$sha" >/dev/null
  echo "Tagged ${OWNER}/${repo}@${default_branch} -> ${tag}"
}

if [[ "$SKIP_COMMIT" == false ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] write platform ${NEW_PLATFORM} to VERSION"
  else
    python3 "$VERSION_LIB" write-platform "$VERSION_FILE" "$NEW_PLATFORM"
    git add "$VERSION_FILE"
    git commit -m "chore(release): platform ${NEW_TAG}"
    git push origin HEAD
    echo "Committed and pushed VERSION platform=${NEW_PLATFORM}"
  fi
fi

for repo in "${RELEASE_REPOS[@]}"; do
  create_tag_on_default_branch "$repo" "$NEW_TAG"
done

echo "Platform release ${NEW_TAG} complete."
echo "Image builds run via each repo's release.yml on tag push."
echo "Customer upgrade: git pull && ./scripts/upgrade.sh full"
