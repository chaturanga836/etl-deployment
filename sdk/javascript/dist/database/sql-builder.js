"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteIdent = quoteIdent;
exports.qualifiedTable = qualifiedTable;
exports.sqlLiteral = sqlLiteral;
exports.primaryKeyColumns = primaryKeyColumns;
exports.buildInsertSql = buildInsertSql;
exports.buildUpdateSql = buildUpdateSql;
exports.buildDeleteSql = buildDeleteSql;
exports.buildSelectWhereSql = buildSelectWhereSql;
exports.defaultSelectSql = defaultSelectSql;
const errors_1 = require("../errors");
function quoteIdent(name) {
    return `"${name.replace(/"/g, '""')}"`;
}
function qualifiedTable(schemaName, tableName) {
    return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
}
function sqlLiteral(value) {
    if (value === null || value === undefined)
        return "NULL";
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "boolean")
        return value ? "TRUE" : "FALSE";
    return `'${String(value).replace(/'/g, "''")}'`;
}
function primaryKeyColumns(columns) {
    const pk = columns.filter((col) => col.primary_key).map((col) => col.name);
    if (pk.length > 0)
        return pk;
    return columns.map((col) => col.name);
}
function buildInsertSql(schemaName, tableName, columns, row, options) {
    const tableRef = qualifiedTable(schemaName, tableName);
    const pkSet = new Set(columns.filter((col) => col.primary_key).map((col) => col.name));
    const entries = columns
        .filter((col) => {
        if (options?.omitPrimaryKeys && pkSet.has(col.name)) {
            const hasDefault = Boolean(col.default);
            const isEmpty = row[col.name] === null || row[col.name] === undefined || row[col.name] === "";
            return !(hasDefault && isEmpty);
        }
        return true;
    })
        .map((col) => [col.name, row[col.name]])
        .filter(([, value]) => value !== undefined);
    const colNames = entries.map(([name]) => quoteIdent(name));
    const values = entries.map(([, value]) => sqlLiteral(value));
    if (entries.length === 0) {
        return `INSERT INTO ${tableRef}\nDEFAULT VALUES;`;
    }
    return `INSERT INTO ${tableRef} (${colNames.join(", ")})\nVALUES (${values.join(", ")});`;
}
function buildUpdateSql(schemaName, tableName, columns, originalRow, changes) {
    const tableRef = qualifiedTable(schemaName, tableName);
    const pkSet = new Set(primaryKeyColumns(columns));
    const columnSet = new Set(columns.map((column) => column.name));
    const setParts = Object.entries(changes)
        .filter(([name]) => columnSet.has(name) && !pkSet.has(name))
        .map(([name, value]) => `${quoteIdent(name)} = ${sqlLiteral(value)}`);
    if (setParts.length === 0) {
        throw new errors_1.DtorchValidationError("Update requires at least one non-primary-key change");
    }
    const whereParts = primaryKeyColumns(columns).map((key) => {
        if (originalRow[key] === undefined) {
            throw new errors_1.DtorchValidationError(`Missing row identity column '${key}'`);
        }
        return `${quoteIdent(key)} = ${sqlLiteral(originalRow[key])}`;
    });
    return `UPDATE ${tableRef}\nSET ${setParts.join(", ")}\nWHERE ${whereParts.join(" AND ")};`;
}
function buildDeleteSql(schemaName, tableName, columns, row) {
    const tableRef = qualifiedTable(schemaName, tableName);
    const whereParts = primaryKeyColumns(columns).map((key) => {
        if (row[key] === undefined) {
            throw new errors_1.DtorchValidationError(`Missing row identity column '${key}'`);
        }
        return `${quoteIdent(key)} = ${sqlLiteral(row[key])}`;
    });
    return `DELETE FROM ${tableRef}\nWHERE ${whereParts.join(" AND ")};`;
}
function buildSelectWhereSql(schemaName, tableName, filter, limit = 100) {
    const tableRef = qualifiedTable(schemaName, tableName);
    const whereParts = Object.entries(filter).map(([key, value]) => `${quoteIdent(key)} = ${sqlLiteral(value)}`);
    const whereClause = whereParts.length > 0 ? `\nWHERE ${whereParts.join(" AND ")}` : "";
    return `SELECT *\nFROM ${tableRef}${whereClause}\nLIMIT ${limit};`;
}
function defaultSelectSql(schemaName, tableName, limit = 100) {
    return `SELECT *\nFROM ${qualifiedTable(schemaName, tableName)}\nLIMIT ${limit};`;
}
