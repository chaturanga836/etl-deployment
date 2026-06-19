"""Read and write elt/config.toml."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore[no-redef]

import tomli_w

DEFAULT_CONFIG_DIR = Path("elt")
DEFAULT_CONFIG_FILE = DEFAULT_CONFIG_DIR / "config.toml"
DEFAULT_MIGRATIONS_DIR = DEFAULT_CONFIG_DIR / "migrations"


def config_path(root: Optional[Path] = None) -> Path:
    base = root or Path.cwd()
    return base / DEFAULT_CONFIG_FILE


def migrations_dir(root: Optional[Path] = None) -> Path:
    base = root or Path.cwd()
    return base / DEFAULT_MIGRATIONS_DIR


def load_config(root: Optional[Path] = None) -> Dict[str, Any]:
    path = config_path(root)
    if not path.is_file():
        raise FileNotFoundError(f"Config not found: {path}. Run `elt init` and `elt link` first.")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Invalid config format in {path}")
    return data


def save_config(data: Dict[str, Any], root: Optional[Path] = None) -> Path:
    path = config_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(tomli_w.dumps(data))
    return path


def require_link(data: Dict[str, Any]) -> tuple[str, int, int]:
    project = data.get("project")
    if not isinstance(project, dict):
        raise ValueError("Missing [project] section in config.toml. Run `elt link`.")
    api_url = project.get("api_url")
    workspace_id = project.get("workspace_id")
    database_id = project.get("database_id")
    if not api_url or workspace_id is None or database_id is None:
        raise ValueError(
            "config.toml must set project.api_url, project.workspace_id, and project.database_id"
        )
    return str(api_url), int(workspace_id), int(database_id)
