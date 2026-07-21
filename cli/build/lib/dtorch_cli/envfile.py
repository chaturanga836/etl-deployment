"""Load project `.env` into process env (Supabase-style)."""

from __future__ import annotations

from pathlib import Path


def load_project_env(root: Path | None = None) -> Path | None:
    """Load `<root>/.env` if present. Does not override existing env vars.

    Returns the path loaded, or None if no file was found.
    """
    base = (root or Path.cwd()).resolve()
    env_path = base / ".env"
    if not env_path.is_file():
        return None

    try:
        from dotenv import load_dotenv
    except ImportError:
        _load_env_fallback(env_path)
    else:
        load_dotenv(env_path, override=False)
    return env_path


def _load_env_fallback(env_path: Path) -> None:
    import os

    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value
