"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltPlatformClient = void 0;
const http_1 = require("./http");
const database_context_1 = require("./database/database-context");
class EltPlatformClient {
    constructor(options) {
        this.workspaceId = options.workspaceId;
        this.http = {
            baseUrl: options.baseUrl,
            auth: {
                type: "project",
                projectKey: options.projectKey,
                projectSecret: options.projectSecret,
            },
            timeoutMs: options.timeoutMs,
        };
    }
    database(databaseId) {
        return new database_context_1.DatabaseContext(this, databaseId);
    }
    listDatabases() {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/databases`);
    }
    listTables(databaseId) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables`);
    }
    getTableDetail(databaseId, tableName) {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}`);
    }
    getTableData(databaseId, tableName, opts) {
        const params = new URLSearchParams();
        if (opts?.limit !== undefined)
            params.set("limit", String(opts.limit));
        if (opts?.offset !== undefined)
            params.set("offset", String(opts.offset));
        const q = params.toString() ? `?${params.toString()}` : "";
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}/data${q}`);
    }
    executeSql(databaseId, sql) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/sql`, { sql });
    }
}
exports.EltPlatformClient = EltPlatformClient;
