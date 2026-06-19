import { requestJson, type HttpClientOptions } from "./http";
import type {
  AccountResponse,
  ProjectCredentialsCreated,
  ProjectCredentialsMeta,
  ProjectListResponse,
  ProjectSummary,
} from "./types/studio";
import type {
  WorkspaceDatabaseCreateBody,
  WorkspaceDatabaseListResponse,
  WorkspaceDatabaseMigrationApplyResponse,
  WorkspaceDatabaseMigrationInput,
  WorkspaceDatabaseMigrationListResponse,
  WorkspaceDatabaseSqlResponse,
  WorkspaceDatabaseStatus,
  WorkspaceDatabaseTableDataResponse,
  WorkspaceDatabaseTableDetail,
  WorkspaceDatabaseTableListResponse,
} from "./types/database";

export type EltClientOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
};

export class EltClient {
  private http: HttpClientOptions;

  constructor(options: EltClientOptions) {
    this.http = {
      baseUrl: options.baseUrl,
      auth: { type: "jwt", getAccessToken: options.getAccessToken },
      timeoutMs: options.timeoutMs,
    };
  }

  signup(body: { email: string; password: string; org_name: string }) {
    return requestJson<{ message: string }>(this.http, "POST", "/api/v1/auth/signup", body);
  }

  getAccount() {
    return requestJson<AccountResponse>(this.http, "GET", "/api/v1/studio/account");
  }

  listProjects(orgId?: number) {
    const q = orgId ? `?org_id=${orgId}` : "";
    return requestJson<ProjectListResponse>(this.http, "GET", `/api/v1/studio/projects${q}`);
  }

  createProject(
    body: { name: string; slug?: string; description?: string; region?: string },
    orgId?: number,
  ) {
    const q = orgId ? `?org_id=${orgId}` : "";
    return requestJson<ProjectSummary>(this.http, "POST", `/api/v1/studio/projects${q}`, body);
  }

  getProjectCredentials(projectId: number) {
    return requestJson<ProjectCredentialsMeta>(
      this.http,
      "GET",
      `/api/v1/studio/projects/${projectId}/credentials`,
    );
  }

  regenerateProjectCredentials(projectId: number) {
    return requestJson<ProjectCredentialsCreated>(
      this.http,
      "POST",
      `/api/v1/studio/projects/${projectId}/credentials/regenerate`,
    );
  }

  listServices(availableOnly = false) {
    const q = availableOnly ? "?available_only=true" : "";
    return requestJson<unknown[]>(this.http, "GET", `/api/v1/studio/services${q}`);
  }

  listWorkspaces() {
    return requestJson<unknown>(this.http, "GET", "/api/v1/workspaces/");
  }

  listDatabases(workspaceId: number) {
    return requestJson<WorkspaceDatabaseListResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${workspaceId}/databases`,
    );
  }

  createDatabase(workspaceId: number, body: WorkspaceDatabaseCreateBody) {
    return requestJson<WorkspaceDatabaseStatus>(
      this.http,
      "POST",
      `/api/v1/workspaces/${workspaceId}/databases`,
      body,
    );
  }

  listTables(workspaceId: number, databaseId: number) {
    return requestJson<WorkspaceDatabaseTableListResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables`,
    );
  }

  getTableDetail(workspaceId: number, databaseId: number, tableName: string) {
    return requestJson<WorkspaceDatabaseTableDetail>(
      this.http,
      "GET",
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}`,
    );
  }

  getTableData(
    workspaceId: number,
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
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/tables/${encodeURIComponent(tableName)}/data${q}`,
    );
  }

  executeSql(workspaceId: number, databaseId: number, sql: string) {
    return requestJson<WorkspaceDatabaseSqlResponse>(
      this.http,
      "POST",
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/sql`,
      { sql },
    );
  }

  listDatabaseMigrations(workspaceId: number, databaseId: number) {
    return requestJson<WorkspaceDatabaseMigrationListResponse>(
      this.http,
      "GET",
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/migrations`,
    );
  }

  applyDatabaseMigrations(
    workspaceId: number,
    databaseId: number,
    migrations: WorkspaceDatabaseMigrationInput[],
    dryRun = false,
  ) {
    return requestJson<WorkspaceDatabaseMigrationApplyResponse>(
      this.http,
      "POST",
      `/api/v1/workspaces/${workspaceId}/databases/${databaseId}/migrations/apply`,
      { migrations, dry_run: dryRun },
    );
  }
}
