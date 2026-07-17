# dtorch-sdk

Python SDK for DT Orch. It includes Studio, project-credential database ORM, runtime, and realtime clients. Legacy `elt_sdk` and `Elt*` imports remain available.

```bash
pip install dtorch-sdk
```

## Studio & workspaces

```python
from dtorch import DtorchClient

client = DtorchClient("https://api.example.com", get_access_token=lambda: "...")
projects = client.list_projects()
```

## Platform database client

Use the project key and one-time project secret generated in DT Orch Studio:

```python
import os
from dtorch import DtorchPlatformClient

client = DtorchPlatformClient(
    os.environ["DTORCH_API_URL"],
    project_key=os.environ["DTORCH_PROJECT_KEY"],
    project_secret=os.environ["DTORCH_PROJECT_SECRET"],
    workspace_id=42,
    database_id=1,
)

client.validate()
users = client.db.table("users")
users.insert({"email": "ada@example.com"})
users.update_by_pk({"id": 1}, {"name": "Ada Lovelace"})
```

## Database migrations

Requires a bearer token with `workspace_admin` on the target workspace.

```python
import os
from dtorch import DtorchClient

client = DtorchClient(
    "https://api.example.com",
    get_access_token=lambda: os.environ["DTORCH_ACCESS_TOKEN"],
)

# List applied migrations on a workspace database
history = client.list_database_migrations(workspace_id=42, database_id=1)
for row in history["migrations"]:
    print(row["version"], row["applied_at"])

# Apply pending migrations (from local files or your own loader)
client.apply_database_migrations(
    42,
    1,
    [
        {
            "version": "20260619120000_create_users",
            "sql": "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT NOT NULL);",
        }
    ],
    dry_run=False,
)
```

For local git-based workflows, use the [dtorch CLI](../cli/README.md):

```bash
pip install ../cli
dtorch init && dtorch link --api-url https://api.example.com --workspace 42 --database 1
dtorch migration new create_users
dtorch db push
```

## Environment

| Variable | Description |
|----------|-------------|
| `DTORCH_ACCESS_TOKEN` | Keycloak JWT (used by CLI; pass to SDK via `get_access_token`) |
| `ELT_ACCESS_TOKEN` | Alias for `DTORCH_ACCESS_TOKEN` |
| `DTORCH_API_URL` / `ELT_API_URL` | API base URL (CLI `dtorch link` writes this to `dtorch/config.toml`) |
