# DT Orch SDK — Master Design Architecture (MDA)

**Audience:** AI coding agents and human implementers building or extending DT Orch SDKs and CLIs.  
**Status:** Canonical design source of truth for all language SDKs.  
**Related:** [AI_REFERENCE.md](AI_REFERENCE.md) (platform ops), [cli/README.md](../cli/README.md), `sdk/*/README.md`.

When implementing or changing any SDK/CLI, follow this document first. Prefer parity with existing behavior in `etl-deployment/sdk/` and `etl-deployment/cli/` unless this MDA explicitly supersedes it.

---

## 1. Purpose

DT Orch SDKs connect a user's **personal application repository** to the **DT Orch platform** so the app can:

1. Authenticate with Studio-issued **project key + project secret**
2. Access provisioned **services** (database, storage, realtime, queues, runtime, …) through typed namespaces
3. Manage **database schema history** via versioned migrations (CLI + SDK APIs), independent of Studio UI DDL

Studio UI remains available for ad-hoc DB operations. Migrations are the **source of truth** for schema evolution in application repos (git history, CI, rollback).

---

## 2. Naming and branding

| Context | Canonical name | Notes |
|---------|----------------|-------|
| Product | **DT Orch** | User-facing brand |
| CLI binary / config dir | `dtorch` / `dtorch/` | Established |
| Env vars | `DTORCH_*` | Prefer over legacy `ELT_*` |
| Package / distribution | `dtorch-*`, `@dtorch/*` | Target; see §10 for migration from `elt` |
| Headers / API | unchanged | `X-Project-Key`, `Authorization: Bearer` |

**Legacy aliases (must keep working until major bump):**

- npm `@elt/sdk` → `@dtorch/sdk`
- pip `elt-sdk` / `elt_sdk` → `dtorch-sdk` / `dtorch`
- Composer `elt/sdk` / `Elt\Sdk` → `dtorch/sdk` / `Dtorch\Sdk`
- Env `ELT_*` → `DTORCH_*`

New code uses DT Orch / dtorch names. Re-export or alias legacy symbols for one major version.

---

## 3. Install model (CLI first)

### 3.1 Golden path

1. User creates a project in **DT Orch Studio** and copies **project key** (`pk_…`) + **project secret** (`ps_…`).
2. User installs **dtorch CLI** for their language ecosystem.
3. User runs `dtorch init` + `dtorch link` (and optionally `dtorch sdk install` / language package managers) in their app repo.
4. App code uses the language SDK with project credentials to call services.
5. Schema changes go through `dtorch migration …` + `dtorch db …` (not only Studio UI).

### 3.2 CLI package install (required surfaces)

| Ecosystem | Install | Binary |
|-----------|---------|--------|
| Node / JS / TS | `npm install -g dtorch-cli` or `npm install -D dtorch-cli` | `dtorch` |
| Python | `pip install dtorch-cli` | `dtorch` |
| PHP | `composer require dtorch/cli` (or `dtorch-cli`) | `vendor/bin/dtorch` |

**Rules for implementers:**

- All three CLIs expose the **same command surface** and flags (§7).
- Prefer thin language wrappers that call a shared contract (HTTP API + local file layout). Do not invent per-language migration formats.
- Publishing: npm, PyPI, Packagist. Local path installs from `etl-deployment/cli` remain valid for development.

### 3.3 SDK package install

| Language | Package | Import / require |
|----------|---------|------------------|
| TypeScript / JavaScript | `npm install @dtorch/sdk` | `import { … } from '@dtorch/sdk'` |
| Python | `pip install dtorch-sdk` | `from dtorch import …` |
| PHP | `composer require dtorch/sdk` | `use Dtorch\Sdk\…` |

CLI may offer helpers:

```bash
dtorch sdk install          # detect language from package.json / pyproject / composer.json
dtorch sdk install --lang ts
```

SDK install via CLI is optional convenience; package managers remain authoritative.

---

## 4. Authentication model

Three first-party auth modes. SDKs must not conflate them. Customer apps use
project credentials only; Keycloak is DT Orch Studio identity, not customer-app identity.

### 4.1 Project credentials (app ↔ platform)

**Use for:** every customer-app operation: database DML, object storage,
notification publish/realtime subscribe, queues, and pipeline/workflow/REST runtime.
**Issued by:** Studio UI (project create / Project Settings → credentials).  
**Shape:**

- Project key: `pk_…`
- Project secret: `ps_…` (shown once on create/regenerate; stored hashed server-side)

**HTTP headers:**

```http
X-Project-Key: pk_...
Authorization: Bearer ps_...
```

**Scopes (current platform default):** `db:read`, `db:write`, `storage:read`,
`storage:write`, `notification:publish`, `notification:subscribe`, `queue:push`,
`queue:pop`, `queue:read`, `pipeline:run`, `workflow:run`, `rest:invoke`.

**Must not allow:** DDL, migrations apply, database provisioning, org/workspace admin. Those require user JWT (§4.2).

**Client constructor (all languages):**

```text
baseUrl, projectKey, projectSecret, workspaceId [, databaseId defaults]
```

Env vars:

| Variable | Purpose |
|----------|---------|
| `DTORCH_API_URL` | API base (no trailing slash required; normalize in client) |
| `DTORCH_PROJECT_KEY` | `pk_…` |
| `DTORCH_PROJECT_SECRET` | `ps_…` |
| `DTORCH_WORKSPACE_ID` | Numeric workspace / project id |
| `DTORCH_DATABASE_ID` | Optional default database id |

### 4.2 User JWT (Studio operators only)

**Use for:** Studio operations, provisioning, DDL, **migration apply**, credential rotation APIs.  
**Source:** Keycloak OIDC (`workspace-realm`).  
**Header:** `Authorization: Bearer <access_token>`  
**Env:** `DTORCH_ACCESS_TOKEN` (alias `ELT_ACCESS_TOKEN`).  
**Role for migrations:** `workspace_admin` (or equivalent) on target workspace.

Customer/end-user apps **must not connect to Keycloak**. Keycloak represents DT Orch
Studio users (super admins, developers, managers, and admins), not users of customer apps.
A future customer-facing auth integration service is planned but does not exist today.

### 4.3 Workspace API keys (runtime automation)

**Use for:** backward compatibility with existing runtime automation.
**Header:** `Authorization: Bearer elt_…` or `X-API-Key: elt_…`  
**Client:** Runtime client namespace (`client.runtime` / `DtorchRuntimeClient`).  
New customer apps use project key/secret for runtime endpoints. Do not require a
separate workspace API key in new app integrations.

### 4.4 Connection validation

Every platform client must implement an explicit validate/ping:

```text
client.validate() → { ok, workspaceId, scopes, … }
```

Behavior:

1. Call a lightweight authenticated endpoint (e.g. credentials self-check or `SELECT 1` via DB read).
2. On 401/403, throw typed auth error with actionable message (regenerate credentials in Studio).
3. CLI `dtorch link` / `dtorch auth check` should use the same validation.

---

## 5. Client architecture and service namespaces

### 5.1 Root clients

| Client | Auth | Responsibility |
|--------|------|----------------|
| `DtorchClient` (Studio) | JWT | Projects, members, provision, migrations apply, Studio APIs |
| `DtorchPlatformClient` | Project key + secret | App access to enabled services |
| `DtorchRuntimeClient` | Project credentials; legacy workspace API key | Pipelines, workflows, queues, notifications invoke |
| `DtorchRealtimeClient` | Project credentials (apps); JWT (Studio) | Centrifugo subscriptions |

Legacy names (`EltClient`, `EltPlatformClient`, …) are aliases.

### 5.2 Platform service namespaces

`DtorchPlatformClient` exposes **one property / sub-client per platform service**. Each maps to a package submodule so languages can tree-shake or optional-install later.

| Namespace | Catalog key | Capability | Auth |
|-----------|-------------|------------|------|
| `client.db` / `client.database(id)` | `postgres` (+ future `mysql`) | Table ORM, SQL DML, schema introspection | Project credentials |
| `client.storage` | `minio` | Object put/list/delete via platform API | Project credentials |
| `client.realtime` | `centrifugo` | Subscribe helpers; publish through runtime | Project credentials |
| `client.runtime.queue*` | `redis` / `rabbitmq` | Enqueue / dequeue / peek | Project credentials |
| `client.runtime` | n/a | Run pipeline/workflow/REST; publish notifications | Project credentials |

**Module layout (TypeScript target):**

```text
@dtorch/sdk
  index                  # re-exports
  client                 # DtorchPlatformClient, DtorchClient, …
  db                     # DatabaseContext, TableModel, sql builders
  storage                # StorageClient
  realtime               # RealtimeClient, channel helpers
  queue                  # QueueClient
  runtime                # RuntimeClient
  migrations             # programmatic apply/list (JWT Studio client)
  errors                 # DtorchError, AuthError, …
```

**Python:**

```text
dtorch/
  __init__.py
  client.py
  db/
  storage/
  realtime/
  queue/
  runtime/
  migrations.py
  errors.py
```

**PHP:**

```text
Dtorch\Sdk\
  Client\
  Db\
  Storage\
  Realtime\
  Queue\
  Runtime\
  Migrations\
  Errors\
```

**Rules:**

- Accessing a namespace for a service not enabled on the workspace must return a clear error (`ServiceNotEnabledError`), not a generic 404.
- Namespaces share HTTP transport, auth headers, retry, and error mapping from the root client.
- Do not put Studio admin methods on `DtorchPlatformClient`.

### 5.3 Database namespace API (minimum)

```text
db = client.database(databaseId)   # or client.db
table = db.table('users')

table.schema()
table.findMany({ limit, offset })
table.findWhere(filter)
table.findOne(filter)
table.insert(row)
table.updateByPk(pk, changes) / update(original, changes)
table.deleteByPk(pk) / delete(row)
table.raw(sql)                     # DML only under project credentials
```

---

## 6. Database migrations

### 6.1 Why migrations exist

Studio UI can create/alter tables. That is insufficient for application teams who need:

- Version history in git
- Repeatable deploy across environments
- Reviewable, reversible schema changes
- CI gates before release

**Golden rule:** After adopting migrations, treat migration files as the only allowed path for schema change. Direct Studio DDL that diverges from local history will break `db push` / `db up`.

### 6.2 Local project layout

```text
my-app/
  dtorch/
    config.toml
    migrations/
      20260619120000_create_users.sql          # simple (up-only) OR
      20260619120000_create_users.up.sql       # paired (preferred going forward)
      20260619120000_create_users.down.sql
    seed.sql                                   # optional; not applied by default
```

Legacy `elt/` config dir: still readable if `dtorch/` missing.

### 6.3 `config.toml`

```toml
[project]
api_url = "https://dtorch.example.com"
workspace_id = 42
database_id = 1
# Optional when using project credentials for validate-only flows:
# project_key = "pk_..."
# Prefer env for secrets — never commit project_secret
```

### 6.4 File naming

| Form | Pattern | Notes |
|------|---------|-------|
| Simple (v1 current) | `{YYYYMMDDHHMMSS}_{name}.sql` | Treated as **up** only |
| Paired (target) | `{YYYYMMDDHHMMSS}_{name}.up.sql` + `.down.sql` | Required for `db down` |

- `name`: `^[a-z][a-z0-9_]*$`
- Sort lexicographically by version prefix
- Remote history table: `elt_migrations.schema_migrations` (`version`, `name`, `applied_at`) — keep name stable unless platform migrates it

### 6.5 SQL constraints (platform-enforced)

Allowed: DDL allowlist (CREATE/ALTER/DROP TABLE/INDEX/… as implemented server-side).  
Blocked: arbitrary DML for migration apply, GRANT, TRUNCATE, DROP DATABASE/SCHEMA, etc.

SDKs/CLIs must surface server validation errors without rewriting SQL.

### 6.6 Auth for migrations

| Operation | Auth |
|-----------|------|
| Create local files | none |
| List remote applied | JWT `workspace_admin` |
| Apply up / push | JWT `workspace_admin` |
| Apply down | JWT `workspace_admin` |
| App DML | Project key + secret |

Project credentials **must not** apply migrations.

### 6.7 Programmatic SDK API (Studio client)

```text
client.listDatabaseMigrations(workspaceId, databaseId)
client.applyDatabaseMigrations(workspaceId, databaseId, [{ version, sql }], dryRun?)
client.revertDatabaseMigrations(workspaceId, databaseId, [{ version, sql }], dryRun?)  # target
```

CLI is the primary UX; SDK APIs support custom tooling and CI libraries.

---

## 7. CLI command surface (all languages)

Binary: `dtorch`

### 7.1 Project bootstrap

| Command | Description |
|---------|-------------|
| `dtorch init [--path .]` | Create `dtorch/config.toml`, `migrations/`, optional `seed.sql` |
| `dtorch link --api-url URL --workspace ID --database ID` | Persist link targets |
| `dtorch auth check` | Validate token or project credentials (target) |
| `dtorch sdk install [--lang ts\|py\|php]` | Install language SDK via npm/pip/composer (target) |

### 7.2 Migrations

| Command | Description |
|---------|-------------|
| `dtorch migration new <name>` | Create timestamped up (+ empty down stub when paired mode on) |
| `dtorch migration list` | Local vs remote status |
| `dtorch db push` / `dtorch db up` | Apply pending **up** migrations (`push` kept as alias) |
| `dtorch db down [--steps N]` | Revert last N migrations using `.down.sql` (target) |
| `dtorch db status` | Alias of `migration list` focused on sync state (target) |
| `dtorch db push --dry-run` | Preview statements |
| `dtorch db push -y` | Non-interactive (CI) |

### 7.3 Auth for CLI apply

```bash
export DTORCH_ACCESS_TOKEN="<keycloak jwt>"
dtorch db up -y
```

### 7.4 CI sketch

```yaml
- run: npm install -g dtorch-cli   # or pip / composer
  env:
    DTORCH_ACCESS_TOKEN: ${{ secrets.DTORCH_ACCESS_TOKEN }}
- run: |
    dtorch link --api-url "$DTORCH_API_URL" --workspace "$WS" --database "$DB"
    dtorch db up -y
```

---

## 8. End-to-end developer flow

```text
┌─────────────────┐     generate pk_/ps_     ┌──────────────────┐
│  DT Orch Studio │ ───────────────────────► │  Developer secrets│
└─────────────────┘                          └────────┬─────────┘
                                                      │
         npm/pip/composer install dtorch-cli          │
                      │                               │
                      ▼                               │
              ┌───────────────┐                       │
              │  App git repo │◄── dtorch init/link ──┘
              │  dtorch/mig…  │
              └───────┬───────┘
                      │ JWT: dtorch db up/down
                      ▼
              ┌───────────────┐
              │ Workspace DB  │  schema_migrations history
              └───────┬───────┘
                      │ App runtime: project key + secret
                      ▼
              ┌───────────────┐
              │ @dtorch/sdk   │── db / storage / realtime / …
              └───────────────┘
```

---

## 9. Cross-language parity matrix

Every language SDK **must** eventually support the same capability set. Gaps are bugs against this MDA.

| Capability | TS/JS | Python | PHP |
|------------|-------|--------|-----|
| Studio client (JWT) | required | required | required |
| Platform client (pk/ps) | required | required | required |
| `validate()` | required | required | required |
| DB table ORM | required | required | required |
| Migrations list/apply (JWT) | required | required | required |
| Runtime client | required | required | required |
| Realtime client | required | required | recommended |
| Storage namespace | required when API ready | same | same |
| Queue namespace | required when API ready | same | same |
| CLI feature parity | via `dtorch-cli` | via `dtorch-cli` | via `dtorch-cli` |

**Current known gaps (implement toward parity):**

- Python SDK: add project-credential storage, realtime, queue, and runtime namespaces
- PHP SDK: expand beyond Studio client to platform + runtime + migrations helpers
- CLI: add `db down`, `auth check`, `sdk install`; publish npm + Composer wrappers; keep Python CLI as reference implementation

---

## 10. Package publishing and repo layout

### 10.1 Source locations (etl-deployment)

```text
etl-deployment/
  cli/                 # dtorch-cli (Python reference; wrappers may live in sdk/*/cli)
  sdk/
    javascript/        # @dtorch/sdk (legacy Elt* exports retained)
    python/            # dtorch-sdk (legacy elt_sdk imports retained)
    php/               # dtorch/sdk (today elt/sdk)
  docs/
    SDK_MDA.md         # this file
    AI_REFERENCE.md    # platform ops (not SDK contract)
```

### 10.2 Versioning

- SemVer across SDKs independently, but **breaking auth/header or migration format changes** require coordinated majors.
- CLI and SDK majors need not match, but document minimum compatible platform API version in each README.

### 10.3 Error model

Shared concepts (names adapt to language idioms):

| Error | When |
|-------|------|
| `DtorchAuthError` | 401/403, invalid pk/ps or JWT |
| `DtorchApiError` | Non-2xx with `statusCode` + `detail` |
| `DtorchMigrationError` | Apply/revert failure, out-of-order versions |
| `DtorchServiceNotEnabledError` | Namespace used for unprovisioned service |
| `DtorchValidationError` | Bad local config / migration filename |

---

## 11. Security requirements (non-negotiable)

1. Never log or commit `ps_…` or JWT access tokens.
2. Secret shown only once in Studio; SDKs must not assume secret retrieval APIs exist.
3. Regeneration invalidates old secret immediately — document in READMEs.
4. Prefer env / secret managers over `config.toml` for secrets.
5. Project credentials are workspace-scoped and cover all customer app services;
   SDK clients must not ask customer apps for Keycloak JWTs or separate runtime keys.
6. Migration apply remains JWT-admin only.

---

## 12. Implementation checklist for AI agents

When adding or changing SDK/CLI code:

1. Read this MDA and the target language's existing `sdk/<lang>/` tree.
2. Preserve header formats and env aliases.
3. Keep CLI commands identical across languages; extend Python CLI first, then port wrappers.
4. For DB schema in **customer apps**, use `dtorch/migrations` — never Alembic (Alembic is platform metadata only in `etl-back`).
5. For platform metadata schema, use `etl-back/alembic` — never customer migration folders.
6. Update language README + this MDA if you change contracts.
7. Add parity notes to §9 when a language still lags.
8. Do not invent a fourth auth mode without updating §4 and backend auth services.
9. Do not add Keycloak login/token handling to customer apps or app-facing examples.
10. Cron/Celery Beat and customer-facing auth services are not implemented; do not
    invent those APIs.

---

## 13. Out of scope

- Replacing Keycloak Studio login with project credentials
- Allowing project credentials to run DDL/migrations
- Customer apps depending on `etl-back` Alembic revisions
- Internal `X-Internal-Token` infra auth (SDK must not expose)

---

## 14. Quick reference — TypeScript example (target API)

```typescript
import { DtorchPlatformClient } from '@dtorch/sdk';

const client = new DtorchPlatformClient({
  baseUrl: process.env.DTORCH_API_URL!,
  projectKey: process.env.DTORCH_PROJECT_KEY!,
  projectSecret: process.env.DTORCH_PROJECT_SECRET!,
  workspaceId: Number(process.env.DTORCH_WORKSPACE_ID),
});

await client.validate();

const users = client.database(1).table('users');
await users.insert({ email: 'ada@example.com' });

// Schema evolution (CLI; JWT):
//   npm install -g dtorch-cli
//   dtorch init && dtorch link --api-url ... --workspace 42 --database 1
//   dtorch migration new create_users
//   dtorch db up -y
//   dtorch db down --steps 1
```

---

*End of MDA. Prefer updating this file over scattering SDK design decisions across chat transcripts or one-off READMEs.*
