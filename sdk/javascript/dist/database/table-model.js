"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TableModel = void 0;
const sql_builder_1 = require("./sql-builder");
class TableModel {
    constructor(client, databaseId, tableName) {
        this.client = client;
        this.databaseId = databaseId;
        this.tableName = tableName;
        this.schemaCache = null;
    }
    async schema() {
        if (!this.schemaCache) {
            this.schemaCache = await this.client.getTableDetail(this.databaseId, this.tableName);
        }
        return this.schemaCache;
    }
    invalidateSchema() {
        this.schemaCache = null;
    }
    async findMany(opts = {}) {
        return this.client.getTableData(this.databaseId, this.tableName, opts);
    }
    async findWhere(filter, limit = 100) {
        const detail = await this.schema();
        const sql = (0, sql_builder_1.buildSelectWhereSql)(detail.schema_name, detail.table_name, filter, limit);
        const result = await this.raw(sql);
        return result.rows ?? [];
    }
    async findOne(filter) {
        const rows = await this.findWhere(filter, 1);
        return rows[0] ?? null;
    }
    async insert(row, options) {
        const detail = await this.schema();
        const sql = (0, sql_builder_1.buildInsertSql)(detail.schema_name, detail.table_name, detail.columns, row, options);
        return this.raw(sql);
    }
    async update(originalRow, changes) {
        const detail = await this.schema();
        const updatedRow = { ...originalRow, ...changes };
        const sql = (0, sql_builder_1.buildUpdateSql)(detail.schema_name, detail.table_name, detail.columns, originalRow, updatedRow);
        return this.raw(sql);
    }
    async updateByPk(pk, changes) {
        return this.update({ ...pk }, changes);
    }
    async delete(row) {
        const detail = await this.schema();
        const sql = (0, sql_builder_1.buildDeleteSql)(detail.schema_name, detail.table_name, detail.columns, row);
        return this.raw(sql);
    }
    async deleteByPk(pk) {
        return this.delete(pk);
    }
    raw(sql) {
        return this.client.executeSql(this.databaseId, sql);
    }
}
exports.TableModel = TableModel;
