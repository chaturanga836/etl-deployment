#!/usr/bin/env python3
"""Issue a signed offline license JWT (vendor-side)."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a signed DT Orch license key")
    parser.add_argument("--customer-id", required=True, help="Customer identifier")
    parser.add_argument("--edition", default="standard", help="License edition")
    parser.add_argument("--days", type=int, default=365, help="Validity in days")
    parser.add_argument("--max-workspaces", type=int, default=None)
    parser.add_argument(
        "--private-key",
        default=None,
        help="Path to RSA private key PEM",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    key_path = Path(args.private_key) if args.private_key else root / "config" / "license-private.pem"
    if not key_path.is_file():
        print(f"Private key not found: {key_path}", file=sys.stderr)
        print("Run: python scripts/generate-license-keys.py", file=sys.stderr)
        return 1

    private_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    now = datetime.now(timezone.utc)
    claims = {
        "sub": args.customer_id,
        "edition": args.edition,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=args.days)).timestamp()),
    }
    if args.max_workspaces is not None:
        claims["max_workspaces"] = args.max_workspaces

    token = jwt.encode(claims, private_key, algorithm="RS256")
    print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
