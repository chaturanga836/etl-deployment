"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseContext = void 0;
const table_model_1 = require("./table-model");
class DatabaseContext {
    constructor(client, databaseId) {
        this.client = client;
        this.databaseId = databaseId;
    }
    table(tableName) {
        return new table_model_1.TableModel(this.client, this.databaseId, tableName);
    }
    listTables() {
        return this.client.listTables(this.databaseId);
    }
    getTableDetail(tableName) {
        return this.client.getTableDetail(this.databaseId, tableName);
    }
    getTableData(tableName, opts) {
        return this.client.getTableData(this.databaseId, tableName, opts);
    }
    raw(sql) {
        return this.client.executeSql(this.databaseId, sql);
    }
}
exports.DatabaseContext = DatabaseContext;
