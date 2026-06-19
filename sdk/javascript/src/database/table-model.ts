import type { EltPlatformClient } from "../platform-client";
import type {
  WorkspaceDatabaseSqlResponse,
  WorkspaceDatabaseTableDataResponse,
  WorkspaceDatabaseTableDetail,
} from "../types/database";
import {
  buildDeleteSql,
  buildInsertSql,
  buildSelectWhereSql,
  buildUpdateSql,
} from "./sql-builder";

export type FindManyOptions = {
  limit?: number;
  offset?: number;
};

export class TableModel {
  private schemaCache: WorkspaceDatabaseTableDetail | null = null;

  constructor(
    private readonly client: EltPlatformClient,
    private readonly databaseId: number,
    readonly tableName: string,
  ) {}

  async schema(): Promise<WorkspaceDatabaseTableDetail> {
    if (!this.schemaCache) {
      this.schemaCache = await this.client.getTableDetail(this.databaseId, this.tableName);
    }
    return this.schemaCache;
  }

  invalidateSchema(): void {
    this.schemaCache = null;
  }

  async findMany(opts: FindManyOptions = {}): Promise<WorkspaceDatabaseTableDataResponse> {
    return this.client.getTableData(this.databaseId, this.tableName, opts);
  }

  async findWhere(
    filter: Record<string, unknown>,
    limit = 100,
  ): Promise<Record<string, unknown>[]> {
    const detail = await this.schema();
    const sql = buildSelectWhereSql(
      detail.schema_name,
      detail.table_name,
      filter,
      limit,
    );
    const result = await this.raw(sql);
    return result.rows ?? [];
  }

  async findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const rows = await this.findWhere(filter, 1);
    return rows[0] ?? null;
  }

  async insert(
    row: Record<string, unknown>,
    options?: { omitPrimaryKeys?: boolean },
  ): Promise<WorkspaceDatabaseSqlResponse> {
    const detail = await this.schema();
    const sql = buildInsertSql(
      detail.schema_name,
      detail.table_name,
      detail.columns,
      row,
      options,
    );
    return this.raw(sql);
  }

  async update(
    originalRow: Record<string, unknown>,
    changes: Record<string, unknown>,
  ): Promise<WorkspaceDatabaseSqlResponse> {
    const detail = await this.schema();
    const updatedRow = { ...originalRow, ...changes };
    const sql = buildUpdateSql(
      detail.schema_name,
      detail.table_name,
      detail.columns,
      originalRow,
      updatedRow,
    );
    return this.raw(sql);
  }

  async updateByPk(
    pk: Record<string, unknown>,
    changes: Record<string, unknown>,
  ): Promise<WorkspaceDatabaseSqlResponse> {
    return this.update({ ...pk }, changes);
  }

  async delete(row: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse> {
    const detail = await this.schema();
    const sql = buildDeleteSql(detail.schema_name, detail.table_name, detail.columns, row);
    return this.raw(sql);
  }

  async deleteByPk(pk: Record<string, unknown>): Promise<WorkspaceDatabaseSqlResponse> {
    return this.delete(pk);
  }

  raw(sql: string): Promise<WorkspaceDatabaseSqlResponse> {
    return this.client.executeSql(this.databaseId, sql);
  }
}
