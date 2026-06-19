# elt-cli

Supabase-style database migrations for ELT workspace databases. Keep versioned SQL files in `elt/migrations/` and apply them with `elt db push`.

## Install

From the `etl-deployment` repo root:

```bash
pip install ./sdk/python
pip install ./cli
```

## Authentication

Export a Keycloak bearer token with `workspace_admin` access to the target workspace:

```bash
export ELT_ACCESS_TOKEN="your-jwt-here"
```

## Quickstart

```bash
# In your application repo
elt init
elt link --api-url https://api.example.com --workspace 42 --database 1

elt migration new create_users
# Edit elt/migrations/<timestamp>_create_users.sql

elt migration list
elt db push
```

## Commands

| Command | Description |
|---------|-------------|
| `elt init` | Create `elt/config.toml` and `elt/migrations/` |
| `elt link` | Set API URL, workspace ID, and database ID |
| `elt migration new <name>` | Create a timestamped `.sql` file |
| `elt migration list` | Compare local files vs remote applied migrations |
| `elt db push` | Apply pending migrations to the remote database |
| `elt db push --dry-run` | Preview without applying |
| `elt db push -y` | Apply without confirmation prompt |

## Project layout

```
my-app/
  elt/
    config.toml
    migrations/
      20260619120000_create_users.sql
    seed.sql          # optional; not applied by db push in v1
```

## CI example

```yaml
- name: Push migrations
  env:
    ELT_ACCESS_TOKEN: ${{ secrets.ELT_ACCESS_TOKEN }}
  run: |
    pip install ./sdk/python ./cli
    elt link --api-url $ELT_API_URL --workspace $WORKSPACE_ID --database $DATABASE_ID
    elt db push -y
```

## Golden rule

After adopting migrations, apply all remote schema changes through migration files. Direct DDL in the dashboard can cause `db push` to fail when local and remote history diverge.
