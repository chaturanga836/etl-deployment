"""Scan local migration files and compute pending sets."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set

_MIGRATION_FILE_RE = re.compile(r"^(\d{14}_[a-z0-9_]+)\.sql$", re.IGNORECASE)


@dataclass
class LocalMigration:
    version: str
    path: Path
    sql: str


def scan_local_migrations(migrations_path: Path) -> List[LocalMigration]:
    if not migrations_path.is_dir():
        return []
    found: List[LocalMigration] = []
    for path in sorted(migrations_path.glob("*.sql")):
        match = _MIGRATION_FILE_RE.match(path.name)
        if not match:
            continue
        version = match.group(1)
        found.append(
            LocalMigration(version=version, path=path, sql=path.read_text(encoding="utf-8"))
        )
    found.sort(key=lambda m: m.version)
    return found


def pending_migrations(
    local: List[LocalMigration], applied_versions: Set[str]
) -> List[LocalMigration]:
    return [m for m in local if m.version not in applied_versions]


def migration_status_rows(
    local: List[LocalMigration], applied: Dict[str, str]
) -> List[tuple[str, str, str]]:
    """Return rows of (version, local_status, remote_status)."""
    local_versions = {m.version for m in local}
    all_versions = sorted(local_versions | set(applied.keys()))
    rows: List[tuple[str, str, str]] = []
    for version in all_versions:
        local_status = "present" if version in local_versions else "missing"
        remote_status = "applied" if version in applied else "not applied"
        rows.append((version, local_status, remote_status))
    return rows
