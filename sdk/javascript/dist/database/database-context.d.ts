import type { EltPlatformClient } from "../platform-client";
import type { WorkspaceDatabaseTableDataResponse, WorkspaceDatabaseTableDetail } from "../types/database";
import { TableModel } from "./table-model";
export declare class DatabaseContext {
    private readonly client;
    readonly databaseId: number;
    constructor(client: EltPlatformClient, databaseId: number);
    table(tableName: string): TableModel;
    listTables(): Promise<import("../types/database").WorkspaceDatabaseTableListResponse>;
    getTableDetail(tableName: string): Promise<WorkspaceDatabaseTableDetail>;
    getTableData(tableName: string, opts?: {
        limit?: number;
        offset?: number;
    }): Promise<WorkspaceDatabaseTableDataResponse>;
    raw(sql: string): Promise<import("../types/database").WorkspaceDatabaseSqlResponse>;
}
