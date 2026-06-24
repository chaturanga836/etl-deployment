#!/usr/bin/env python3
"""Generate RSA key pair for offline license signing (vendor-side)."""

from __future__ import annotations

import argparse
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=None, help="Output directory")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    out = Path(args.out_dir) if args.out_dir else root / "config"
    out.mkdir(parents=True, exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    (out / "license-private.pem").write_bytes(priv)
    (out / "license-public.pem").write_bytes(pub)
    print(f"Wrote {out / 'license-private.pem'}")
    print(f"Wrote {out / 'license-public.pem'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
