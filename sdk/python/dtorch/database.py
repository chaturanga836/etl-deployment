"""Workspace database context, table model, and SQL builders."""

from __future__ import annotations

import json
import math
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Sequence

from dtorch.errors import DtorchValidationError

if TYPE_CHECKING:
    from dtorch.platform_client import DtorchPlatformClient


def quote_ident(name: str) -> str:
    return f'"{name.replace(chr(34), chr(34) * 2)}"'


def qualified_table(schema_name: str, table_name: str) -> str:
    return f"{quote_ident(schema_name)}.{quote_ident(table_name)}"


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not math.isfinite(value):
            raise DtorchValidationError("SQL numeric values must be finite")
        return str(value)
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, separators=(",", ":"))
    return f"'{str(value).replace(chr(39), chr(39) * 2)}'"


def _primary_key_columns(columns: Sequence[Mapping[str, Any]]) -> List[str]:
    primary_keys = [str(column["name"]) for column in columns if column.get("primary_key")]
    return primary_keys or [str(column["name"]) for column in columns]


def _identity_where(
    columns: Sequence[Mapping[str, Any]],
    row: Mapping[str, Any],
) -> str:
    parts: List[str] = []
    for key in _primary_key_columns(columns):
        if key not in row:
            raise DtorchValidationError(f"Missing row identity column '{key}'")
        parts.append(f"{quote_ident(key)} = {sql_literal(row[key])}")
    return " AND ".join(parts)


class DatabaseContext:
    def __init__(self, client: "DtorchPlatformClient", database_id: int) -> None:
        self._client = client
        self.database_id = database_id

    def table(self, table_name: str) -> "TableModel":
        return TableModel(self._client, self.database_id, table_name)

    def list_tables(self) -> Dict[str, Any]:
        return self._client.list_tables(self.database_id)

    def get_table_detail(self, table_name: str) -> Dict[str, Any]:
        return self._client.get_table_detail(self.database_id, table_name)

    def get_table_data(
        self,
        table_name: str,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self._client.get_table_data(
            self.database_id,
            table_name,
            limit=limit,
            offset=offset,
        )

    def raw(self, sql: str) -> Dict[str, Any]:
        return self._client.execute_sql(self.database_id, sql)


class TableModel:
    def __init__(
        self,
        client: "DtorchPlatformClient",
        database_id: int,
        table_name: str,
    ) -> None:
        self._client = client
        self._database_id = database_id
        self.table_name = table_name
        self._schema_cache: Optional[Dict[str, Any]] = None

    def schema(self) -> Dict[str, Any]:
        if self._schema_cache is None:
            self._schema_cache = self._client.get_table_detail(
                self._database_id,
                self.table_name,
            )
        return self._schema_cache

    def invalidate_schema(self) -> None:
        self._schema_cache = None

    def find_many(
        self,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self._client.get_table_data(
            self._database_id,
            self.table_name,
            limit=limit,
            offset=offset,
        )

    def find_where(
        self,
        filter_values: Mapping[str, Any],
        *,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        if limit < 1:
            raise DtorchValidationError("limit must be at least 1")
        detail = self.schema()
        where_parts = [
            f"{quote_ident(key)} = {sql_literal(value)}"
            for key, value in filter_values.items()
        ]
        where = f"\nWHERE {' AND '.join(where_parts)}" if where_parts else ""
        sql = (
            f"SELECT *\nFROM {qualified_table(detail['schema_name'], detail['table_name'])}"
            f"{where}\nLIMIT {limit};"
        )
        result = self.raw(sql)
        return list(result.get("rows") or [])

    def find_one(self, filter_values: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
        rows = self.find_where(filter_values, limit=1)
        return rows[0] if rows else None

    def insert(
        self,
        row: Mapping[str, Any],
        *,
        omit_primary_keys: bool = False,
    ) -> Dict[str, Any]:
        detail = self.schema()
        columns = detail["columns"]
        primary_keys = {
            str(column["name"]) for column in columns if column.get("primary_key")
        }
        entries = []
        for column in columns:
            name = str(column["name"])
            if name not in row:
                continue
            value = row[name]
            if (
                omit_primary_keys
                and name in primary_keys
                and column.get("default")
                and (value is None or value == "")
            ):
                continue
            entries.append((name, value))
        table = qualified_table(detail["schema_name"], detail["table_name"])
        if not entries:
            return self.raw(f"INSERT INTO {table}\nDEFAULT VALUES;")
        names = ", ".join(quote_ident(name) for name, _ in entries)
        values = ", ".join(sql_literal(value) for _, value in entries)
        return self.raw(f"INSERT INTO {table} ({names})\nVALUES ({values});")

    def update(
        self,
        original_row: Mapping[str, Any],
        changes: Mapping[str, Any],
    ) -> Dict[str, Any]:
        detail = self.schema()
        columns = detail["columns"]
        column_names = {str(column["name"]) for column in columns}
        identity_names = set(_primary_key_columns(columns))
        assignments = [
            f"{quote_ident(name)} = {sql_literal(value)}"
            for name, value in changes.items()
            if name in column_names and name not in identity_names
        ]
        if not assignments:
            raise DtorchValidationError("Update requires at least one non-primary-key change")
        table = qualified_table(detail["schema_name"], detail["table_name"])
        where = _identity_where(columns, original_row)
        return self.raw(f"UPDATE {table}\nSET {', '.join(assignments)}\nWHERE {where};")

    def update_by_pk(
        self,
        primary_key: Mapping[str, Any],
        changes: Mapping[str, Any],
    ) -> Dict[str, Any]:
        self._assert_primary_key(primary_key)
        return self.update(primary_key, changes)

    def delete(self, row: Mapping[str, Any]) -> Dict[str, Any]:
        detail = self.schema()
        table = qualified_table(detail["schema_name"], detail["table_name"])
        where = _identity_where(detail["columns"], row)
        return self.raw(f"DELETE FROM {table}\nWHERE {where};")

    def delete_by_pk(self, primary_key: Mapping[str, Any]) -> Dict[str, Any]:
        self._assert_primary_key(primary_key)
        return self.delete(primary_key)

    def raw(self, sql: str) -> Dict[str, Any]:
        return self._client.execute_sql(self._database_id, sql)

    def _assert_primary_key(self, values: Mapping[str, Any]) -> None:
        columns = self.schema()["columns"]
        keys = [str(column["name"]) for column in columns if column.get("primary_key")]
        if not keys:
            raise DtorchValidationError(f"Table '{self.table_name}' has no primary key")
        missing = [key for key in keys if key not in values]
        if missing:
            raise DtorchValidationError(
                f"Missing primary key column(s): {', '.join(missing)}"
            )
