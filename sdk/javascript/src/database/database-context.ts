import type { EltPlatformClient } from "../platform-client";
import type {
  WorkspaceDatabaseTableDataResponse,
  WorkspaceDatabaseTableDetail,
} from "../types/database";
import { TableModel } from "./table-model";

export class DatabaseContext {
  constructor(
    private readonly client: EltPlatformClient,
    readonly databaseId: number,
  ) {}

  table(tableName: string): TableModel {
    return new TableModel(this.client, this.databaseId, tableName);
  }

  listTables() {
    return this.client.listTables(this.databaseId);
  }

  getTableDetail(tableName: string) {
    return this.client.getTableDetail(this.databaseId, tableName);
  }

  getTableData(
    tableName: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<WorkspaceDatabaseTableDataResponse> {
    return this.client.getTableData(this.databaseId, tableName, opts);
  }

  raw(sql: string) {
    return this.client.executeSql(this.databaseId, sql);
  }
}
