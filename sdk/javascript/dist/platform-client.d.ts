import { DatabaseContext } from "./database/database-context";
import type { WorkspaceDatabaseListResponse, WorkspaceDatabaseSqlResponse, WorkspaceDatabaseTableDataResponse, WorkspaceDatabaseTableDetail, WorkspaceDatabaseTableListResponse } from "./types/database";
export type EltPlatformClientOptions = {
    baseUrl: string;
    projectKey: string;
    projectSecret: string;
    workspaceId: number;
    databaseId?: number;
    timeoutMs?: number;
};
export declare class EltPlatformClient {
    private http;
    readonly workspaceId: number;
    readonly defaultDatabaseId?: number;
    constructor(options: EltPlatformClientOptions);
    database(databaseId: number): DatabaseContext;
    /** Default database namespace configured with `databaseId`. */
    get db(): DatabaseContext;
    /** Validate project credentials against the linked workspace. */
    validate(): Promise<{
        ok: true;
        workspaceId: number;
        databases: import("./types/database").WorkspaceDatabaseItem[];
    }>;
    listDatabases(): Promise<WorkspaceDatabaseListResponse>;
    listTables(databaseId: number): Promise<WorkspaceDatabaseTableListResponse>;
    getTableDetail(databaseId: number, tableName: string): Promise<WorkspaceDatabaseTableDetail>;
    getTableData(databaseId: number, tableName: string, opts?: {
        limit?: number;
        offset?: number;
    }): Promise<WorkspaceDatabaseTableDataResponse>;
    executeSql(databaseId: number, sql: string): Promise<WorkspaceDatabaseSqlResponse>;
}
