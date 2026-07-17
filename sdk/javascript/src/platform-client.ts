import { requestJson, type HttpClientOptions } from "./http";
import { DatabaseContext } from "./database/database-context";
import { DtorchValidationError } from "./errors";
import { EltRealtimeClient } from "./realtime-client";
import { EltRuntimeClient } from "./runtime-client";
import type {
  WorkspaceDatabaseListResponse,
  WorkspaceDatabaseSqlResponse,
  WorkspaceDatabaseTableDataResponse,
  WorkspaceDatabaseTableDetail,
  WorkspaceDatabaseTableListResponse,
} from "./types/database";

export type WorkspaceStorageStatus = {
  workspace_id: number;
  status: string;
  mode?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  endpoint_url?: string | null;
  plan?: string | null;
  s3_uri?: string | null;
  provisioned_at?: string | null;
  error?: string | null;
  can_provision: boolean;
};

export type StorageObjectItem = {
  key: string;
  name: string;
  type: string;
  size: string;
  size_bytes?: number | null;
  modified?: string | null;
};

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
  readonly storage: {
    getStatus: () => Promise<WorkspaceStorageStatus>;
    listObjects: (prefix?: string) => Promise<{ items: StorageObjectItem[]; prefix: string }>;
    uploadObject: (
      file: Blob,
      options?: { key?: string; fileName?: string },
    ) => Promise<{ key: string; name: string }>;
    deleteObject: (key: string) => Promise<void>;
  };
  readonly runtime: EltRuntimeClient;
  readonly realtime: EltRealtimeClient;
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
    this.runtime = new EltRuntimeClient({
      baseUrl: options.baseUrl,
      projectKey: options.projectKey,
      projectSecret: options.projectSecret,
      workspaceId: options.workspaceId,
      timeoutMs: options.timeoutMs,
    });
    this.realtime = new EltRealtimeClient({
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
    const [validation, databases] = await Promise.all([
      requestJson<{ ok: true; workspace_id: number; scopes: string[] }>(
        this.http,
        "GET",
        `/api/v1/workspaces/${this.workspaceId}/project/validate`,
      ),
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

  getStorageStatus() {
    return requestJson<WorkspaceStorageStatus>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/storage`,
    );
  }

  listStorageObjects(prefix = "") {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    return requestJson<{ items: StorageObjectItem[]; prefix: string }>(
      this.http,
      "GET",
      `/api/v1/workspaces/${this.workspaceId}/storage/objects${query}`,
    );
  }

  uploadStorageObject(file: Blob, options?: { key?: string; fileName?: string }) {
    const form = new FormData();
    form.append("file", file, options?.fileName ?? options?.key ?? "upload");
    const query = options?.key ? `?key=${encodeURIComponent(options.key)}` : "";
    return requestJson<{ key: string; name: string }>(
      this.http,
      "POST",
      `/api/v1/workspaces/${this.workspaceId}/storage/objects${query}`,
      form,
    );
  }

  deleteStorageObject(key: string) {
    return requestJson<void>(
      this.http,
      "DELETE",
      `/api/v1/workspaces/${this.workspaceId}/storage/objects?key=${encodeURIComponent(key)}`,
    );
  }
}
