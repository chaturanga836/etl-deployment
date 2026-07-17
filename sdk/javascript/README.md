# @dtorch/sdk

TypeScript/JavaScript SDK for DT Orch — Studio administration, runtime automation, and workspace database ORM. Legacy `Elt*` class names remain exported for compatibility.

## Install

```bash
npm install @dtorch/sdk
```

## Admin setup

1. Create a project in the Studio UI (or via `DtorchClient.createProject`).
2. Copy the **project key** (`pk_…`) and **project secret** (`ps_…`) from the one-time modal.
3. Store the secret securely. It is not shown again unless you regenerate in **Project Settings → API credentials**.

## Studio client (JWT)

For organization admins managing projects, databases, and migrations:

```typescript
import { DtorchClient } from '@dtorch/sdk';

const client = new DtorchClient({
  baseUrl: process.env.DTORCH_API_URL!,
  getAccessToken: async () => process.env.DTORCH_ACCESS_TOKEN!,
});

const project = await client.createProject({ name: 'My App' });
// project.credentials contains client_key + client_secret (once)
```

## Customer app client (project key + secret)

Customer apps use one client and one credential pair for every provisioned app service.
They do not connect to Keycloak.

```typescript
import { DtorchPlatformClient } from '@dtorch/sdk';

const client = new DtorchPlatformClient({
  baseUrl: process.env.DTORCH_API_URL!,
  projectKey: process.env.DTORCH_PROJECT_KEY!,
  projectSecret: process.env.DTORCH_PROJECT_SECRET!,
  workspaceId: 42,
  databaseId: 1, // optional default for client.db
});

await client.validate();
const users = client.database(1).table('users');

const page = await users.findMany({ limit: 50, offset: 0 });
await users.insert({ email: 'ada@example.com', name: 'Ada' });
await users.updateByPk({ id: 1 }, { name: 'Ada Lovelace' });
await users.deleteByPk({ id: 1 });

const matches = await users.findWhere({ email: 'ada@example.com' });
const custom = await users.raw('SELECT count(*) FROM "public"."users";');

// Managed MinIO storage
await client.storage.uploadObject(
  new Blob(['hello'], { type: 'text/plain' }),
  { key: 'demo/hello.txt' },
);
const objects = await client.storage.listObjects('demo/');

// Runtime services use the same project credentials
await client.runtime.queuePush('events', { type: 'demo.created' });
await client.runtime.notificationPublish('demo', { message: 'Created' });
await client.runtime.runPipeline('pipeline-uuid', { foo: 'bar' });

// Realtime token minting also uses the same project credentials
await client.realtime.connect();
client.realtime.subscribe('org:1:ws:42:channel:demo', console.log);
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

## Legacy runtime API keys

`DtorchRuntimeClient` still accepts a workspace API key for existing integrations.
New customer apps should use `DtorchPlatformClient.runtime` with project credentials.

```typescript
import { DtorchRuntimeClient } from '@dtorch/sdk';

const runtime = new DtorchRuntimeClient({
  baseUrl: process.env.DTORCH_API_URL!,
  apiKey: process.env.DTORCH_API_KEY!,
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
- Project credentials cover customer app services: database DML, storage objects, notifications/realtime, queues, and runtime invocation.
- Customer apps must not connect to Keycloak. Keycloak JWT is for DT Orch Studio operators only.
- DDL, migrations, provisioning, and credential rotation remain Studio/operator operations.
- Use environment variables or a secrets manager — never commit credentials.

## Errors

```typescript
import { DtorchApiError } from '@dtorch/sdk';

try {
  await client.executeSql(1, 'SELECT 1');
} catch (err) {
  if (err instanceof DtorchApiError) {
    console.error(err.statusCode, err.detail);
  }
}
```
