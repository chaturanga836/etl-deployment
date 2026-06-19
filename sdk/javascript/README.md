# @elt/sdk

TypeScript/JavaScript client for the ELT Engine API — studio admin, runtime automation, and workspace database ORM.

## Install

```bash
npm install
npm run build
```

## Admin setup

1. Create a project in the studio UI (or via `EltClient.createProject`).
2. Copy the **project key** (`pk_…`) and **project secret** (`ps_…`) from the one-time modal.
3. Store the secret securely. It is not shown again unless you regenerate in **Project Settings → API credentials**.

## Studio client (JWT)

For organization admins managing projects, databases, and migrations:

```typescript
import { EltClient } from '@elt/sdk';

const client = new EltClient({
  baseUrl: process.env.ELT_API_URL!,
  getAccessToken: async () => process.env.DTORCH_ACCESS_TOKEN!,
});

const project = await client.createProject({ name: 'My App' });
// project.credentials contains client_key + client_secret (once)
```

## Platform client + ORM (project key + secret)

For customer apps and scripts that read/write workspace database tables:

```typescript
import { EltPlatformClient } from '@elt/sdk';

const client = new EltPlatformClient({
  baseUrl: process.env.DTORCH_API_URL!,
  projectKey: process.env.DTORCH_PROJECT_KEY!,
  projectSecret: process.env.DTORCH_PROJECT_SECRET!,
  workspaceId: 42,
});

const users = client.database(1).table('users');

const page = await users.findMany({ limit: 50, offset: 0 });
await users.insert({ email: 'ada@example.com', name: 'Ada' });
await users.updateByPk({ id: 1 }, { name: 'Ada Lovelace' });
await users.deleteByPk({ id: 1 });

const matches = await users.findWhere({ email: 'ada@example.com' });
const custom = await users.raw('SELECT count(*) FROM "public"."users";');
```

### ORM methods

| Method | Description |
|--------|-------------|
| `schema()` | Table columns, indexes, foreign keys (cached) |
| `findMany({ limit, offset })` | Paginated rows via HTTP |
| `findWhere(filter)` | Equality filter → `SELECT` |
| `findOne(filter)` | First matching row |
| `insert(row)` | `INSERT` from schema |
| `update(original, changes)` | `UPDATE` by primary key |
| `delete(row)` | `DELETE` by primary key |
| `raw(sql)` | Execute DML SQL directly |

## Runtime client (API key)

For pipeline/workflow execution (separate from project credentials):

```typescript
import { EltRuntimeClient } from '@elt/sdk';

const runtime = new EltRuntimeClient({
  baseUrl: process.env.ELT_API_URL!,
  apiKey: process.env.ELT_API_KEY!,
  workspaceId: 42,
});

await runtime.runPipeline('pipeline-uuid', { foo: 'bar' });
```

## Authentication headers

Project credentials are sent as:

```
X-Project-Key: pk_...
Authorization: Bearer ps_...
```

## Security notes

- The project secret is hashed server-side and returned in full only on create or regenerate.
- Regenerating invalidates the previous secret immediately.
- Project credentials can access database read/write APIs only (`db:read`, `db:write`). DDL, migrations, and provisioning require a user JWT with admin role — use `dtorch db push` or `EltClient` with `DTORCH_ACCESS_TOKEN`.
- Use environment variables or a secrets manager — never commit credentials.

## Errors

```typescript
import { EltClientError } from '@elt/sdk';

try {
  await client.executeSql(1, 'SELECT 1');
} catch (err) {
  if (err instanceof EltClientError) {
    console.error(err.statusCode, err.detail);
  }
}
```
