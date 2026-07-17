import { DatabaseContext } from "./database/database-context";
import { EltRealtimeClient } from "./realtime-client";
import { EltRuntimeClient } from "./runtime-client";
import type { WorkspaceDatabaseListResponse, WorkspaceDatabaseSqlResponse, WorkspaceDatabaseTableDataResponse, WorkspaceDatabaseTableDetail, WorkspaceDatabaseTableListResponse } from "./types/database";
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
export declare class EltPlatformClient {
    private http;
    readonly storage: {
        getStatus: () => Promise<WorkspaceStorageStatus>;
        listObjects: (prefix?: string) => Promise<{
            items: StorageObjectItem[];
            prefix: string;
        }>;
        uploadObject: (file: Blob, options?: {
            key?: string;
            fileName?: string;
        }) => Promise<{
            key: string;
            name: string;
        }>;
        deleteObject: (key: string) => Promise<void>;
    };
    readonly runtime: EltRuntimeClient;
    readonly realtime: EltRealtimeClient;
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
        scopes: string[];
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
    getStorageStatus(): Promise<WorkspaceStorageStatus>;
    listStorageObjects(prefix?: string): Promise<{
        items: StorageObjectItem[];
        prefix: string;
    }>;
    uploadStorageObject(file: Blob, options?: {
        key?: string;
        fileName?: string;
    }): Promise<{
        key: string;
        name: string;
    }>;
    deleteStorageObject(key: string): Promise<void>;
}
