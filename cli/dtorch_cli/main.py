"""Dtorch CLI entrypoint."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import click

from dtorch_cli.client import EltClientError, apply_migrations, fetch_applied_versions, get_access_token, make_client
from dtorch_cli.config import (
    DEFAULT_CONFIG_DIR,
    DEFAULT_MIGRATIONS_DIR,
    load_config,
    migrations_dir,
    require_link,
    save_config,
)
from dtorch_cli.migrations import migration_status_rows, pending_migrations, scan_local_migrations

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


@click.group()
def cli() -> None:
    """Dtorch CLI — database migrations for workspace databases."""


@cli.command()
@click.option("--path", "root", type=click.Path(path_type=Path), default=".", show_default=True)
def init(root: Path) -> None:
    """Create dtorch/ with config.toml and migrations/ directory."""
    config_dir = root / DEFAULT_CONFIG_DIR
    migrations = root / DEFAULT_MIGRATIONS_DIR
    config_dir.mkdir(parents=True, exist_ok=True)
    migrations.mkdir(parents=True, exist_ok=True)

    config_file = config_dir / "config.toml"
    if not config_file.exists():
        save_config(
            {
                "project": {
                    "api_url": "",
                    "workspace_id": 0,
                    "database_id": 0,
                }
            },
            root,
        )

    seed = config_dir / "seed.sql"
    if not seed.exists():
        seed.write_text("-- Optional seed data (not applied by db push in v1)\n", encoding="utf-8")

    click.echo(f"Initialized {config_dir}/")
    click.echo("Next: run `dtorch link` to connect to your workspace database.")


@cli.command()
@click.option("--api-url", required=True, help="API base URL (e.g. https://api.example.com)")
@click.option("--workspace", "workspace_id", required=True, type=int, help="Workspace ID")
@click.option("--database", "database_id", required=True, type=int, help="Database ID")
@click.option("--path", "root", type=click.Path(path_type=Path), default=".", show_default=True)
def link(api_url: str, workspace_id: int, database_id: int, root: Path) -> None:
    """Save API URL and workspace/database targeting to dtorch/config.toml."""
    config_dir = root / DEFAULT_CONFIG_DIR
    if not config_dir.exists():
        click.echo("Run `dtorch init` first.", err=True)
        raise SystemExit(1)

    save_config(
        {
            "project": {
                "api_url": api_url.rstrip("/"),
                "workspace_id": workspace_id,
                "database_id": database_id,
            }
        },
        root,
    )
    click.echo(f"Linked workspace {workspace_id}, database {database_id} at {api_url}")


@cli.group()
def migration() -> None:
    """Manage local SQL migration files."""


@migration.command("new")
@click.argument("name")
@click.option("--path", "root", type=click.Path(path_type=Path), default=".", show_default=True)
def migration_new(name: str, root: Path) -> None:
    """Create a new timestamped migration file under dtorch/migrations/."""
    normalized = name.strip().lower().replace("-", "_")
    if not _NAME_RE.match(normalized):
        click.echo("Name must use lowercase letters, digits, and underscores.", err=True)
        raise SystemExit(1)

    migrations = migrations_dir(root)
    migrations.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    version = f"{timestamp}_{normalized}"
    path = migrations / f"{version}.sql"
    if path.exists():
        click.echo(f"Migration already exists: {path}", err=True)
        raise SystemExit(1)

    path.write_text(f"-- Migration: {version}\n\n", encoding="utf-8")
    click.echo(f"Created {path}")


@migration.command("list")
@click.option("--path", "root", type=click.Path(path_type=Path), default=".", show_default=True)
def migration_list(root: Path) -> None:
    """Show local migration files vs remote applied status."""
    try:
        config = load_config(root)
        api_url, workspace_id, database_id = require_link(config)
    except (FileNotFoundError, ValueError) as exc:
        click.echo(str(exc), err=True)
        raise SystemExit(1) from exc

    local = scan_local_migrations(migrations_dir(root))
    try:
        client = make_client(api_url)
        applied = fetch_applied_versions(client, workspace_id, database_id)
    except EltClientError as exc:
        click.echo(f"API error ({exc.status_code}): {exc}", err=True)
        raise SystemExit(1) from exc

    rows = migration_status_rows(local, applied)
    if not rows:
        click.echo("No local or remote migrations.")
        return

    click.echo(f"{'VERSION':<40} {'LOCAL':<10} {'REMOTE'}")
    click.echo("-" * 70)
    for version, local_status, remote_status in rows:
        click.echo(f"{version:<40} {local_status:<10} {remote_status}")


@cli.group()
def db() -> None:
    """Apply migrations to the linked remote database."""


@db.command("push")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
@click.option("--dry-run", is_flag=True, help="Preview without applying")
@click.option("--path", "root", type=click.Path(path_type=Path), default=".", show_default=True)
def db_push(root: Path, yes: bool, dry_run: bool) -> None:
    """Apply pending local migrations to the remote database."""
    try:
        config = load_config(root)
        api_url, workspace_id, database_id = require_link(config)
    except (FileNotFoundError, ValueError) as exc:
        click.echo(str(exc), err=True)
        raise SystemExit(1) from exc

    if not get_access_token():
        click.echo(
            "Set DTORCH_ACCESS_TOKEN (or ELT_ACCESS_TOKEN) to a valid Keycloak bearer token.",
            err=True,
        )
        raise SystemExit(1)

    local = scan_local_migrations(migrations_dir(root))
    if not local:
        click.echo("No migration files in dtorch/migrations/.")
        return

    try:
        client = make_client(api_url)
        applied = fetch_applied_versions(client, workspace_id, database_id)
    except EltClientError as exc:
        click.echo(f"API error ({exc.status_code}): {exc}", err=True)
        raise SystemExit(1) from exc

    pending = pending_migrations(local, set(applied.keys()))
    if not pending:
        click.echo("Remote database is up to date.")
        return

    click.echo("Pending migrations:")
    for item in pending:
        click.echo(f"  - {item.version}")

    if dry_run:
        payload = apply_migrations(
            client,
            workspace_id,
            database_id,
            [{"version": m.version, "sql": m.sql} for m in pending],
            dry_run=True,
        )
        click.echo(f"Dry run: {payload.get('statements_executed', 0)} statements would execute.")
        for preview in payload.get("previews", []):
            click.echo(f"  {preview.get('version')}: {preview.get('statement_count')} statements")
        return

    if not yes:
        click.echo("")
        if not click.confirm(f"Apply {len(pending)} migration(s) to remote database?", default=False):
            click.echo("Aborted.")
            raise SystemExit(0)

    try:
        result = apply_migrations(
            client,
            workspace_id,
            database_id,
            [{"version": m.version, "sql": m.sql} for m in pending],
            dry_run=False,
        )
    except EltClientError as exc:
        click.echo(f"Apply failed ({exc.status_code}): {exc}", err=True)
        raise SystemExit(1) from exc

    applied_versions = result.get("applied_versions", [])
    click.echo(f"Applied {len(applied_versions)} migration(s), {result.get('statements_executed', 0)} statements.")
    for version in applied_versions:
        click.echo(f"  - {version}")


if __name__ == "__main__":
    cli(prog_name="dtorch")
