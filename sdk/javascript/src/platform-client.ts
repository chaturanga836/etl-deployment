import { requestJson, type HttpClientOptions } from "./http";
import { DatabaseContext } from "./database/database-context";
import { DtorchValidationError } from "./errors";
import type {
  WorkspaceDatabaseListResponse,
  WorkspaceDatabaseSqlResponse,
  WorkspaceDatabaseTableDataResponse,
  WorkspaceDatabaseTableDetail,
  WorkspaceDatabaseTableListResponse,
} from "./types/database";

export type EltPlatformClientOptions = {
  baseUrl: string;
  projectKey: string;
  projectSecret: string;
  workspaceId: number;
  databaseId?: number;
  timeoutMs?: number;
};

export class EltPlatformClient {
  private http: HttpClientOptions;
  readonly workspaceId: number;
  readonly defaultDatabaseId?: number;

  constructor(options: EltPlatformClientOptions) {
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
  }

  database(databaseId: number): DatabaseContext {
    return new DatabaseContext(this, databaseId);
  }

  /** Default database namespace configured with `databaseId`. */
  get db(): DatabaseContext {
    if (this.defaultDatabaseId === undefined) {
      throw new DtorchValidationError(
        "No default database configured; pass databaseId or call database(id)",
      );
    }
    return this.database(this.defaultDatabaseId);
  }

  /** Validate project credentials against the linked workspace. */
  async validate() {
    const response = await this.listDatabases();
    return {
      ok: true as const,
      workspaceId: this.workspaceId,
      databases: response.databases,
    };
  }

  listDatabases() {
    return requestJson<WorkspaceDatabaseListResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/databases`,
    );
  }

  listTables(databaseId: number) {
    return requestJson<WorkspaceDatabaseTableListResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables`,
    );
  }

  getTableDetail(databaseId: number, tableName: string) {
    return requestJson<WorkspaceDatabaseTableDetail>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}`,
    );
  }

  getTableData(
    databaseId: number,
    tableName: string,
    opts?: { limit?: number; offset?: number },
  ) {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const q = params.toString() ? `?${params.toString()}` : "";
    return requestJson<WorkspaceDatabaseTableDataResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}/data${q}`,
    );
  }

  executeSql(databaseId: number, sql: string) {
    return requestJson<WorkspaceDatabaseSqlResponse>(
      this.http,
      "POST",
      `/api/v1/workspaces/${this.workspaceId}/databases/${databaseId}/sql`,
      { sql },
    );
  }
}
