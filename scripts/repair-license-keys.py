#!/usr/bin/env python3
"""Ensure config/ holds a matching RSA license keypair (required for free trials)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "installer"))

from shared.license import ensure_license_keypair  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create or repair license-public.pem + license-private.pem"
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory for key files (default: <repo>/config)",
    )
    args = parser.parse_args()

    out = Path(args.out_dir) if args.out_dir else ROOT / "config"
    before_pub = (out / "license-public.pem").is_file()
    before_priv = (out / "license-private.pem").is_file()
    ensure_license_keypair(out)
    if not before_pub or not before_priv:
        print(f"Generated license key pair in {out}")
    elif before_pub and before_priv:
        print(f"License key pair OK in {out}")
    else:
        print(f"Repaired license key pair in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
