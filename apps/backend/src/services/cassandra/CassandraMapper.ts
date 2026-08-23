import type cassandra from "cassandra-driver";
import type {
  NonSelectResult,
  SchemaKeyspaceNode,
  StatementQueryResult,
  SelectResult
} from "@cqlstudio/shared";

interface CassandraColumnMeta {
  name: string;
  type?: {
    code?: string | number;
    info?: unknown;
  };
}

interface CassandraTableMeta {
  name: string;
  columns?: CassandraColumnMeta[];
}

interface CassandraKeyspaceMeta {
  name: string;
  tables?: Record<string, CassandraTableMeta>;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, mapValue] of value.entries()) {
      out[String(key)] = serializeValue(mapValue);
    }
    return out;
  }

  if (value instanceof Set) {
    return [...value].map((item) => serializeValue(item));
  }

  if (typeof value === "object") {
    if ("toString" in value && typeof value.toString === "function") {
      const tag = Object.prototype.toString.call(value);
      if (tag !== "[object Object]") {
        return value.toString();
      }
    }

    const out: Record<string, unknown> = {};
    for (const [key, objectValue] of Object.entries(value)) {
      out[key] = serializeValue(objectValue);
    }
    return out;
  }

  return value;
}

export function mapQueryResult(
  result: cassandra.types.ResultSet,
  cql: string,
  executionTimeMs: number
): StatementQueryResult {
  const isDescribeKeyspaces = /^\s*describe\s+keyspaces\s*;?\s*$/i.test(cql);

  const isSelectByText = /^\s*select\b/i.test(cql);
  const hasColumns = (result.columns?.length ?? 0) > 0;

  if (isSelectByText || hasColumns) {
    if (isDescribeKeyspaces) {
      const seen = new Set<string>();
      const rows = result.rows
        .map((row) => {
          const record = row as unknown as Record<string, unknown>;
          const rawName =
            typeof record.name === "string"
              ? record.name
              : typeof record.keyspace_name === "string"
                ? record.keyspace_name
                : null;

          if (!rawName || seen.has(rawName)) {
            return null;
          }

          seen.add(rawName);
          return {
            name: rawName
          };
        })
        .filter((item): item is { name: string } => item !== null);

      const describeResult: SelectResult = {
        statementType: "SELECT",
        columns: ["name"],
        rows,
        rowCount: rows.length,
        executionTimeMs
      };

      return describeResult;
    }

    const columns = (result.columns ?? []).map((column) => column.name);
    const rows = result.rows.map((row) => {
      const mappedRow: Record<string, unknown> = {};
      for (const columnName of columns) {
        mappedRow[columnName] = serializeValue((row as unknown as Record<string, unknown>)[columnName]);
      }
      return mappedRow;
    });

    const selectResult: SelectResult = {
      statementType: "SELECT",
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs
    };

    return selectResult;
  }

  const nonSelectResult: NonSelectResult = {
    statementType: "NON_SELECT",
    message: "Statement executed successfully.",
    executionTimeMs,
    applied: typeof result.wasApplied === "function" ? result.wasApplied() : undefined
  };

  return nonSelectResult;
}

export function mapSchema(keyspaces: CassandraKeyspaceMeta[]): SchemaKeyspaceNode[] {
  return keyspaces
    .filter((keyspace) => keyspace.name && !keyspace.name.startsWith("system"))
    .map((keyspace) => {
      const tables = Object.values(keyspace.tables ?? {})
        .map((table) => ({
          name: table.name,
          columns: (table.columns ?? []).map((column) => ({
            name: column.name,
            type: column.type?.code
              ? `${column.type.code}${column.type.info ? `(${String(column.type.info)})` : ""}`
              : "unknown",
            isPrimaryKey: false,
            isPartitionKey: false,
            isClusteringColumn: false,
            keyPosition: null,
            clusteringOrder: null,
            isStatic: false
          }))
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        name: keyspace.name,
        tables
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
