import type { EltPlatformClient } from "../platform-client";
import type { WorkspaceDatabaseSqlResponse, WorkspaceDatabaseTableDataResponse, WorkspaceDatabaseTableDetail } from "../types/database";
export type FindManyOptions = {
    limit?: number;
    offset?: number;
};
export declare class TableModel {
    private readonly client;
    private readonly databaseId;
    readonly tableName: string;
    private schemaCache;
    constructor(client: EltPlatformClient, databaseId: number, tableName: string);
    schema(): Promise<WorkspaceDatabaseTableDetail>;
    invalidateSchema(): void;
    findMany(opts?: FindManyOptions): Promise<WorkspaceDatabaseTableDataResponse>;
    findWhere(filter: Record<string, unknown>, limit?: number): Promise<Record<string, unknown>[]>;
    findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    insert(row: Record<string, unknown>, options?: {
        omitPrimaryKeys?: boolean;
    }): Promise<WorkspaceDatabaseSqlResponse>;
    update(originalRow: Record<string, unknown>, changes: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse>;
    updateByPk(pk: Record<string, unknown>, changes: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse>;
    delete(row: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse>;
    deleteByPk(pk: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse>;
    raw(sql: string): Promise<WorkspaceDatabaseSqlResponse>;
}
