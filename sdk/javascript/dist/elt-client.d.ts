import type { AccountResponse, ProjectCredentialsCreated, ProjectCredentialsMeta, ProjectListResponse, ProjectSummary } from "./types/studio";
import type { WorkspaceDatabaseCreateBody, WorkspaceDatabaseListResponse, WorkspaceDatabaseMigrationApplyResponse, WorkspaceDatabaseMigrationInput, WorkspaceDatabaseMigrationListResponse, WorkspaceDatabaseSqlResponse, WorkspaceDatabaseStatus, WorkspaceDatabaseTableDataResponse, WorkspaceDatabaseTableDetail, WorkspaceDatabaseTableListResponse } from "./types/database";
export type EltClientOptions = {
    baseUrl: string;
    getAccessToken?: () => Promise<string | null> | string | null;
    timeoutMs?: number;
};
export declare class EltClient {
    private http;
    constructor(options: EltClientOptions);
    signup(body: {
        email: string;
        password: string;
        org_name: string;
    }): Promise<{
        message: string;
    }>;
    getAccount(): Promise<AccountResponse>;
    listProjects(orgId?: number): Promise<ProjectListResponse>;
    createProject(body: {
        name: string;
        slug?: string;
        description?: string;
        region?: string;
    }, orgId?: number): Promise<ProjectSummary>;
    getProjectCredentials(projectId: number): Promise<ProjectCredentialsMeta>;
    regenerateProjectCredentials(projectId: number): Promise<ProjectCredentialsCreated>;
    listServices(availableOnly?: boolean): Promise<unknown[]>;
    listWorkspaces(): Promise<unknown>;
    listDatabases(workspaceId: number): Promise<WorkspaceDatabaseListResponse>;
    createDatabase(workspaceId: number, body: WorkspaceDatabaseCreateBody): Promise<WorkspaceDatabaseStatus>;
    listTables(workspaceId: number, databaseId: number): Promise<WorkspaceDatabaseTableListResponse>;
    getTableDetail(workspaceId: number, databaseId: number, tableName: string): Promise<WorkspaceDatabaseTableDetail>;
    getTableData(workspaceId: number, databaseId: number, tableName: string, opts?: {
        limit?: number;
        offset?: number;
    }): Promise<WorkspaceDatabaseTableDataResponse>;
    executeSql(workspaceId: number, databaseId: number, sql: string): Promise<WorkspaceDatabaseSqlResponse>;
    listDatabaseMigrations(workspaceId: number, databaseId: number): Promise<WorkspaceDatabaseMigrationListResponse>;
    applyDatabaseMigrations(workspaceId: number, databaseId: number, migrations: WorkspaceDatabaseMigrationInput[], dryRun?: boolean): Promise<WorkspaceDatabaseMigrationApplyResponse>;
}
