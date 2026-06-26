#!/usr/bin/env python3
"""Parse VERSION, bump semver, and sync install .env image pins."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

IMAGE_KEYS = {
    "API_IMAGE": "dt-orch-api",
    "FRONTEND_IMAGE": "dt-orch-frontend",
    "INFRA_IMAGE": "baas-infra",
    "SCRAPER_IMAGE": "dt-orch-scraper",
}

DEFAULT_REGISTRY = "ghcr.io/chaturanga836"
DEFAULT_PLATFORM = "1.0.0"


def normalize_registry(registry: str) -> str:
    return registry.strip().rstrip("/")


def image_ref(registry: str, image_name: str, tag: str) -> str:
    registry = normalize_registry(registry)
    normalized_tag = tag if tag.startswith("v") else f"v{tag}"
    return f"{registry}/{image_name}:{normalized_tag}"


def image_ref_template(image_name: str) -> str:
    return f"${{REGISTRY_URL}}/{image_name}:${{IMAGE_TAG}}"


def repair_image_ref(ref: str, registry: str, image_name: str, tag: str) -> str:
    """Rebuild canonical GHCR ref and collapse duplicated org path segments."""
    registry = normalize_registry(registry)
    org = registry.rsplit("/", 1)[-1]
    if org:
        duplicate = f"{registry}/{org}/{image_name}:"
        if duplicate in ref:
            ref = ref.replace(f"{registry}/{org}/", f"{registry}/", 1)
    return image_ref(registry, image_name, tag)


def parse_version_file(path: Path) -> tuple[str, str]:
    """Return (platform semver without leading v, registry_url)."""
    platform = DEFAULT_PLATFORM
    registry = DEFAULT_REGISTRY
    in_registry = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("platform:"):
            platform = line.split(":", 1)[1].strip().strip("\"'")
            if platform.startswith("v"):
                platform = platform[1:]
        elif line.startswith("registry:"):
            in_registry = True
        elif in_registry and line.startswith("url:"):
            url = line.split(":", 1)[1].strip().strip("\"'")
            if url and url != "ghcr.io/YOUR_GITHUB_ORG":
                registry = url
        elif re.match(r"^[a-z_]+:", line):
            in_registry = False
    return platform, registry


def image_tag(platform: str) -> str:
    return platform if platform.startswith("v") else f"v{platform}"


def bump_semver(platform: str, kind: str = "patch") -> str:
    normalized = platform.lstrip("v")
    parts = normalized.split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"Invalid platform version: {platform}")
    major, minor, patch = (int(part) for part in parts)
    if kind == "major":
        major += 1
        minor = 0
        patch = 0
    elif kind == "minor":
        minor += 1
        patch = 0
    else:
        patch += 1
    return f"{major}.{minor}.{patch}"


def write_platform_version(path: Path, platform: str) -> None:
    normalized = platform.lstrip("v")
    text = path.read_text(encoding="utf-8")
    new_text, count = re.subn(
        r'^platform:\s*["\']?[^"\']+["\']?',
        f'platform: "{normalized}"',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(f"Could not update platform in {path}")
    path.write_text(new_text, encoding="utf-8")


def sync_env_from_version(env_path: Path, version_path: Path) -> bool:
    platform, registry = parse_version_file(version_path)
    tag = image_tag(platform)
    text = env_path.read_text(encoding="utf-8")
    changed = False
    out: list[str] = []

    for line in text.splitlines():
        if line.lstrip().startswith("#") or not line.strip():
            out.append(line)
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not match:
            out.append(line)
            continue
        key, val = match.group(1), match.group(2)
        if key == "REGISTRY_URL":
            new_val = registry
        elif key == "IMAGE_TAG":
            new_val = tag
        elif key in IMAGE_KEYS:
            image_name = IMAGE_KEYS[key]
            if "YOUR_GITHUB_ORG" in val or "${" in val:
                new_val = image_ref_template(image_name)
            elif "/" in val and ":" in val:
                new_val = repair_image_ref(val, registry, image_name, tag)
            else:
                new_val = image_ref_template(image_name)
        else:
            out.append(line)
            continue
        if val != new_val:
            changed = True
        out.append(f"{key}={new_val}")

    if changed:
        env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="DT Orch VERSION helpers")
    sub = parser.add_subparsers(dest="cmd", required=True)

    show = sub.add_parser("show", help="Print platform and registry from VERSION")
    show.add_argument("version_file", type=Path)

    bump = sub.add_parser("bump", help="Print bumped platform version")
    bump.add_argument("version_file", type=Path)
    bump.add_argument(
        "--kind",
        choices=("patch", "minor", "major"),
        default="patch",
    )

    write = sub.add_parser("write-platform", help="Write platform version to VERSION")
    write.add_argument("version_file", type=Path)
    write.add_argument("platform", help="Semver without v, e.g. 1.0.1")

    sync = sub.add_parser("sync-env", help="Sync .env image pins from VERSION")
    sync.add_argument("env_file", type=Path)
    sync.add_argument("version_file", type=Path)

    args = parser.parse_args()

    if args.cmd == "show":
        platform, registry = parse_version_file(args.version_file)
        print(f"{platform}\t{registry}\t{image_tag(platform)}")
        return 0

    if args.cmd == "bump":
        platform, _ = parse_version_file(args.version_file)
        print(bump_semver(platform, args.kind))
        return 0

    if args.cmd == "write-platform":
        write_platform_version(args.version_file, args.platform)
        return 0

    if args.cmd == "sync-env":
        if sync_env_from_version(args.env_file, args.version_file):
            print(f"Synced image pins from {args.version_file} -> {args.env_file}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
