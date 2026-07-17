import type { WorkspaceDatabaseTableColumn } from "../types/database";
export declare function quoteIdent(name: string): string;
export declare function qualifiedTable(schemaName: string, tableName: string): string;
export declare function sqlLiteral(value: unknown): string;
export declare function primaryKeyColumns(columns: WorkspaceDatabaseTableColumn[]): string[];
export declare function buildInsertSql(schemaName: string, tableName: string, columns: WorkspaceDatabaseTableColumn[], row: Record<string, unknown>, options?: {
    omitPrimaryKeys?: boolean;
}): string;
export declare function buildUpdateSql(schemaName: string, tableName: string, columns: WorkspaceDatabaseTableColumn[], originalRow: Record<string, unknown>, changes: Record<string, unknown>): string;
export declare function buildDeleteSql(schemaName: string, tableName: string, columns: WorkspaceDatabaseTableColumn[], row: Record<string, unknown>): string;
export declare function buildSelectWhereSql(schemaName: string, tableName: string, filter: Record<string, unknown>, limit?: number): string;
export declare function defaultSelectSql(schemaName: string, tableName: string, limit?: number): string;
