export type WorkspaceDatabaseEngine = "postgres" | "mysql";

export type WorkspaceDatabaseEngineInfo = {
  key: WorkspaceDatabaseEngine;
  label: string;
  available: boolean;
};

export type WorkspaceDatabaseCatalog = {
  engines: WorkspaceDatabaseEngineInfo[];
};

export type WorkspaceDatabaseItem = {
  id: number;
  name: string;
  engine: WorkspaceDatabaseEngine;
  status: string;
  provisioned_at?: string;
  instance_ref?: string;
  container_created?: boolean;
};

export type WorkspaceDatabaseListResponse = {
  databases: WorkspaceDatabaseItem[];
  has_databases: boolean;
};

export type WorkspaceDatabaseStatus = {
  provisioned: boolean;
  engine?: WorkspaceDatabaseEngine;
  name?: string;
  provisioned_at?: string;
  databases?: WorkspaceDatabaseItem[];
};

export type WorkspaceDatabaseCreateBody = {
  engine: WorkspaceDatabaseEngine;
  name: string;
};

export type WorkspaceDatabaseTableSummary = {
  name: string;
};

export type WorkspaceDatabaseTableListResponse = {
  database_id: number;
  schema_name: string;
  tables: WorkspaceDatabaseTableSummary[];
};

export type WorkspaceDatabaseTableColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  primary_key: boolean;
};

export type WorkspaceDatabaseTableIndex = {
  name: string;
  columns: string[];
  unique: boolean;
};

export type WorkspaceDatabaseTableForeignKey = {
  name: string;
  constrained_columns: string[];
  referred_schema: string;
  referred_table: string;
  referred_columns: string[];
  on_delete?: string | null;
};

export type WorkspaceDatabaseTableDetail = {
  database_id: number;
  schema_name: string;
  table_name: string;
  columns: WorkspaceDatabaseTableColumn[];
  indexes?: WorkspaceDatabaseTableIndex[];
  foreign_keys?: WorkspaceDatabaseTableForeignKey[];
};

export type WorkspaceDatabaseTableDataResponse = {
  database_id: number;
  schema_name: string;
  table_name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
};

export type WorkspaceDatabaseSqlResponse = {
  ok: boolean;
  statement_type: "select" | "insert" | "update" | "delete";
  rows_affected?: number;
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  truncated?: boolean;
};

export type WorkspaceDatabaseMigrationInput = {
  version: string;
  sql: string;
};

export type WorkspaceDatabaseMigrationListResponse = {
  database_id: number;
  schema_name: string;
  migrations: { version: string; name?: string | null; applied_at: string }[];
};

export type WorkspaceDatabaseMigrationApplyResponse = {
  ok: boolean;
  dry_run: boolean;
  applied_versions: string[];
  statements_executed: number;
  previews: { version: string; statement_count: number }[];
};

export type WorkspaceDatabaseDdlResponse = {
  ok: boolean;
  statements_executed: number;
};
