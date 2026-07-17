"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltPlatformClient = void 0;
const http_1 = require("./http");
const database_context_1 = require("./database/database-context");
const errors_1 = require("./errors");
const realtime_client_1 = require("./realtime-client");
const runtime_client_1 = require("./runtime-client");
class EltPlatformClient {
    constructor(options) {
        this.workspaceId = options.workspaceId;
        this.defaultDatabaseId = options.databaseId;
        this.http = {
            baseUrl: options.baseUrl,
            auth: {
                type: "project",
                projectKey: options.projectKey,
                projectSecret: options.projectSecret,
            },
            timeoutMs: options.timeoutMs,
        };
        this.runtime = new runtime_client_1.EltRuntimeClient({
            baseUrl: options.baseUrl,
            projectKey: options.projectKey,
            projectSecret: options.projectSecret,
            workspaceId: options.workspaceId,
            timeoutMs: options.timeoutMs,
        });
        this.realtime = new realtime_client_1.EltRealtimeClient({
            baseUrl: options.baseUrl,
            projectKey: options.projectKey,
            projectSecret: options.projectSecret,
            workspaceId: options.workspaceId,
            timeoutMs: options.timeoutMs,
        });
        this.storage = {
            getStatus: () => this.getStorageStatus(),
            listObjects: (prefix) => this.listStorageObjects(prefix),
            uploadObject: (file, uploadOptions) => this.uploadStorageObject(file, uploadOptions),
            deleteObject: (key) => this.deleteStorageObject(key),
        };
    }
    database(databaseId) {
        return new database_context_1.DatabaseContext(this, databaseId);
    }
    /** Default database namespace configured with `databaseId`. */
    get db() {
        if (this.defaultDatabaseId === undefined) {
            throw new errors_1.DtorchValidationError("No default database configured; pass databaseId or call database(id)");
        }
        return this.database(this.defaultDatabaseId);
    }
    /** Validate project credentials against the linked workspace. */
    async validate() {
        const [validation, databases] = await Promise.all([
            (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/project/validate`),
            this.listDatabases(),
        ]);
        return {
            ok: validation.ok,
            workspaceId: validation.workspace_id,
            scopes: validation.scopes,
            databases: databases.databases,
        };
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
    getStorageStatus() {
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/storage`);
    }
    listStorageObjects(prefix = "") {
        const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
        return (0, http_1.requestJson)(this.http, "GET", `/api/v1/workspaces/${this.workspaceId}/storage/objects${query}`);
    }
    uploadStorageObject(file, options) {
        const form = new FormData();
        form.append("file", file, options?.fileName ?? options?.key ?? "upload");
        const query = options?.key ? `?key=${encodeURIComponent(options.key)}` : "";
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/workspaces/${this.workspaceId}/storage/objects${query}`, form);
    }
    deleteStorageObject(key) {
        return (0, http_1.requestJson)(this.http, "DELETE", `/api/v1/workspaces/${this.workspaceId}/storage/objects?key=${encodeURIComponent(key)}`);
    }
}
exports.EltPlatformClient = EltPlatformClient;
