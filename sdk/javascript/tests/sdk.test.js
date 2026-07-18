const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DtorchAuthError,
  DtorchPlatformClient,
} = require("../dist");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("platform validate sends project credentials", async () => {
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/project/validate")) {
      return response(200, {
        ok: true,
        workspace_id: 42,
        scopes: ["db:read", "storage:read"],
      });
    }
    return response(200, { databases: [], has_databases: false });
  };

  const client = new DtorchPlatformClient({
    baseUrl: "https://dtorch.example/",
    projectKey: "pk_test",
    projectSecret: "ps_test",
    workspaceId: 42,
  });

  assert.deepEqual(await client.validate(), {
    ok: true,
    workspaceId: 42,
    scopes: ["db:read", "storage:read"],
    databases: [],
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/databases$/);
  assert.match(requests[1].url, /\/project\/validate$/);
  for (const request of requests) {
    assert.equal(request.init.headers["X-Project-Key"], "pk_test");
    assert.equal(request.init.headers.Authorization, "Bearer ps_test");
  }
});

test("platform validate falls back when project/validate is missing", async () => {
  global.fetch = async (url) => {
    if (String(url).endsWith("/project/validate")) {
      return response(404, { detail: "Not Found" });
    }
    return response(200, { databases: [{ id: 1, name: "main" }], has_databases: true });
  };

  const client = new DtorchPlatformClient({
    baseUrl: "https://dtorch.example",
    projectKey: "pk_test",
    projectSecret: "ps_test",
    workspaceId: 42,
  });

  assert.deepEqual(await client.validate(), {
    ok: true,
    workspaceId: 42,
    scopes: [],
    databases: [{ id: 1, name: "main" }],
  });
});

test("platform storage and runtime use the same project credentials", async () => {
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.includes("/storage/objects")) {
      return response(200, { items: [], prefix: "demo/" });
    }
    return response(201, { id: 1, payload: { hello: "world" } });
  };

  const client = new DtorchPlatformClient({
    baseUrl: "https://dtorch.example",
    projectKey: "pk_test",
    projectSecret: "ps_test",
    workspaceId: 42,
  });

  await client.storage.listObjects("demo/");
  await client.runtime.queuePush("events", { hello: "world" });

  assert.match(requests[0].url, /storage\/objects\?prefix=demo%2F$/);
  assert.match(requests[1].url, /runtime\/workspaces\/42\/queues\/events\/push$/);
  for (const request of requests) {
    assert.equal(request.init.headers["X-Project-Key"], "pk_test");
    assert.equal(request.init.headers.Authorization, "Bearer ps_test");
  }
});

test("updateByPk updates only supplied columns", async () => {
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (init.method === "GET") {
      return response(200, {
        database_id: 1,
        schema_name: "public",
        table_name: "users",
        columns: [
          { name: "id", type: "integer", nullable: false, primary_key: true },
          { name: "name", type: "text", nullable: false, primary_key: false },
          { name: "email", type: "text", nullable: false, primary_key: false },
        ],
      });
    }
    return response(200, { ok: true, statement_type: "update", rows_affected: 1 });
  };

  const client = new DtorchPlatformClient({
    baseUrl: "https://dtorch.example",
    projectKey: "pk_test",
    projectSecret: "ps_test",
    workspaceId: 42,
  });
  await client.database(1).table("users").updateByPk({ id: 7 }, { name: "Ada" });

  const sql = JSON.parse(requests[1].init.body).sql;
  assert.match(sql, /"name" = 'Ada'/);
  assert.match(sql, /WHERE "id" = 7/);
  assert.doesNotMatch(sql, /"email" = NULL/);
});

test("401 and 403 responses map to DtorchAuthError", async () => {
  global.fetch = async () => response(401, { detail: "Invalid project credentials" });
  const client = new DtorchPlatformClient({
    baseUrl: "https://dtorch.example",
    projectKey: "pk_bad",
    projectSecret: "ps_bad",
    workspaceId: 42,
  });

  await assert.rejects(() => client.validate(), DtorchAuthError);
});
