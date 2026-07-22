import type { WorkspaceDatabaseTableColumn } from "../types/database";
import { DtorchValidationError } from "../errors";

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifiedTable(schemaName: string, tableName: string): string {
  return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  // Escape `:` so SQLAlchemy text() does not treat JSON like `"index":1` as bind `:1`.
  return `'${String(value).replace(/'/g, "''").replace(/:/g, "\\:")}'`;
}

export function primaryKeyColumns(columns: WorkspaceDatabaseTableColumn[]): string[] {
  const pk = columns.filter((col) => col.primary_key).map((col) => col.name);
  if (pk.length > 0) return pk;
  return columns.map((col) => col.name);
}

export function buildInsertSql(
  schemaName: string,
  tableName: string,
  columns: WorkspaceDatabaseTableColumn[],
  row: Record<string, unknown>,
  options?: { omitPrimaryKeys?: boolean },
): string {
  const tableRef = qualifiedTable(schemaName, tableName);
  const pkSet = new Set(columns.filter((col) => col.primary_key).map((col) => col.name));
  const entries = columns
    .filter((col) => {
      if (options?.omitPrimaryKeys && pkSet.has(col.name)) {
        const hasDefault = Boolean(col.default);
        const isEmpty =
          row[col.name] === null || row[col.name] === undefined || row[col.name] === "";
        return !(hasDefault && isEmpty);
      }
      return true;
    })
    .map((col) => [col.name, row[col.name]] as const)
    .filter(([, value]) => value !== undefined);

  const colNames = entries.map(([name]) => quoteIdent(name));
  const values = entries.map(([, value]) => sqlLiteral(value));
  if (entries.length === 0) {
    return `INSERT INTO ${tableRef}\nDEFAULT VALUES;`;
  }
  return `INSERT INTO ${tableRef} (${colNames.join(", ")})\nVALUES (${values.join(", ")});`;
}

export function buildUpdateSql(
  schemaName: string,
  tableName: string,
  columns: WorkspaceDatabaseTableColumn[],
  originalRow: Record<string, unknown>,
  changes: Record<string, unknown>,
): string {
  const tableRef = qualifiedTable(schemaName, tableName);
  const pkSet = new Set(primaryKeyColumns(columns));
  const columnSet = new Set(columns.map((column) => column.name));
  const setParts = Object.entries(changes)
    .filter(([name]) => columnSet.has(name) && !pkSet.has(name))
    .map(([name, value]) => `${quoteIdent(name)} = ${sqlLiteral(value)}`);
  if (setParts.length === 0) {
    throw new DtorchValidationError("Update requires at least one non-primary-key change");
  }
  const whereParts = primaryKeyColumns(columns).map((key) => {
    if (originalRow[key] === undefined) {
      throw new DtorchValidationError(`Missing row identity column '${key}'`);
    }
    return `${quoteIdent(key)} = ${sqlLiteral(originalRow[key])}`;
  });
  return `UPDATE ${tableRef}\nSET ${setParts.join(", ")}\nWHERE ${whereParts.join(" AND ")};`;
}

export function buildDeleteSql(
  schemaName: string,
  tableName: string,
  columns: WorkspaceDatabaseTableColumn[],
  row: Record<string, unknown>,
): string {
  const tableRef = qualifiedTable(schemaName, tableName);
  const whereParts = primaryKeyColumns(columns).map((key) => {
    if (row[key] === undefined) {
      throw new DtorchValidationError(`Missing row identity column '${key}'`);
    }
    return `${quoteIdent(key)} = ${sqlLiteral(row[key])}`;
  });
  return `DELETE FROM ${tableRef}\nWHERE ${whereParts.join(" AND ")};`;
}

export function buildSelectWhereSql(
  schemaName: string,
  tableName: string,
  filter: Record<string, unknown>,
  limit = 100,
): string {
  const tableRef = qualifiedTable(schemaName, tableName);
  const whereParts = Object.entries(filter).map(
    ([key, value]) => `${quoteIdent(key)} = ${sqlLiteral(value)}`,
  );
  const whereClause = whereParts.length > 0 ? `\nWHERE ${whereParts.join(" AND ")}` : "";
  return `SELECT *\nFROM ${tableRef}${whereClause}\nLIMIT ${limit};`;
}

export function defaultSelectSql(schemaName: string, tableName: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedTable(schemaName, tableName)}\nLIMIT ${limit};`;
}
