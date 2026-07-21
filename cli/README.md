# dtorch-cli

Supabase-style database migrations for Dtorch workspace databases. Keep versioned SQL files in `dtorch/migrations/` and apply them with `dtorch db push`.

## Install

```bash
pip install dtorch-cli
# pulls dtorch-sdk automatically once both are on PyPI
dtorch --help
# or: python -m dtorch_cli --help
```

Until PyPI publish, install both packages from the platform checkout:

```bash
pip install ./sdk/python ./cli
```

Do **not** require customers to clone platform repos for day-to-day use — publish wheels and install via `pip install dtorch-cli`.

## Authentication

Export a Keycloak bearer token with `workspace_admin` access to the target workspace:

```bash
export DTORCH_ACCESS_TOKEN="your-jwt-here"
```

`ELT_ACCESS_TOKEN` is also accepted for backward compatibility.

## Quickstart

```bash
# In your application repo
dtorch init
dtorch link --api-url https://api.example.com --workspace 42 --database 1

dtorch migration new create_users
# Edit dtorch/migrations/<timestamp>_create_users.sql

dtorch migration list
dtorch db push
```

## Commands

| Command | Description |
|---------|-------------|
| `dtorch init` | Create `dtorch/config.toml` and `dtorch/migrations/` |
| `dtorch link` | Set API URL, workspace ID, and database ID |
| `dtorch migration new <name>` | Create a timestamped `.sql` file |
| `dtorch migration list` | Compare local files vs remote applied migrations |
| `dtorch db push` | Apply pending migrations to the remote database |
| `dtorch db push --dry-run` | Preview without applying |
| `dtorch db push -y` | Apply without confirmation prompt |

## Project layout

```
my-app/
  dtorch/
    config.toml
    migrations/
      20260619120000_create_users.sql
    seed.sql          # optional; not applied by db push in v1
```

Legacy `elt/` config directories are still read if `dtorch/` is not present.

## CI example

```yaml
- name: Push migrations
  env:
    DTORCH_ACCESS_TOKEN: ${{ secrets.DTORCH_ACCESS_TOKEN }}
  run: |
    pip install ./sdk/python ./cli
    dtorch link --api-url $DTORCH_API_URL --workspace $WORKSPACE_ID --database $DATABASE_ID
    dtorch db push -y
```

## Golden rule

After adopting migrations, apply all remote schema changes through migration files. Direct DDL in the dashboard can cause `db push` to fail when local and remote history diverge.
