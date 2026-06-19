"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltClient = void 0;
const http_1 = require("./http");
class EltClient {
    constructor(options) {
        this.http = {
            baseUrl: options.baseUrl,
            auth: { type: "jwt", getAccessToken: options.getAccessToken },
            timeoutMs: options.timeoutMs,
        };
    }
    signup(body) {
        return (0, http_1.requestJson)(this.http, "POST", "/api/v1/auth/signup", body);
    }
    getAccount() {
        return (0, http_1.requestJson)(this.http, "GET", "/api/v1/studio/account");
    }
    listProjects(orgId) {
        const q = orgId ? `?org_id=${orgId}` : "";
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/studio/projects${q}`);
    }
    createProject(body, orgId) {
        const q = orgId ? `?org_id=${orgId}` : "";
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/studio/projects${q}`, body);
    }
    getProjectCredentials(projectId) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/studio/projects/${projectId}/credentials`);
    }
    regenerateProjectCredentials(projectId) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/studio/projects/${projectId}/credentials/regenerate`);
    }
    listServices(availableOnly = false) {
        const q = availableOnly ? "?available_only=true" : "";
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/studio/services${q}`);
    }
    listWorkspaces() {
        return (0, http_1.requestJson)(this.http, "GET", "/api/v1/workspaces/");
    }
    listDatabases(workspaceId) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${workspaceId}/databases`);
    }
    createDatabase(workspaceId, body) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/workspaces/${workspaceId}/databases`, body);
    }
    listTables(workspaceId, databaseId) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables`);
    }
    getTableDetail(workspaceId, databaseId, tableName) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}`);
    }
    getTableData(workspaceId, databaseId, tableName, opts) {
        const params = new URLSearchParams();
        if (opts?.limit !== undefined)
            params.set("limit", String(opts.limit));
        if (opts?.offset !== undefined)
            params.set("offset", String(opts.offset));
        const q = params.toString() ? `?${params.toString()}` : "";
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}/data${q}`);
    }
    executeSql(workspaceId, databaseId, sql) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/sql`, { sql });
    }
    listDatabaseMigrations(workspaceId, databaseId) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/migrations`);
    }
    applyDatabaseMigrations(workspaceId, databaseId, migrations, dryRun = false) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/migrations/apply`, { migrations, dry_run: dryRun });
    }
}
exports.EltClient = EltClient;
