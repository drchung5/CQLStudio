import type cassandra from "cassandra-driver";
import type {
  ConnectionRequest,
  QueryExecutionResult,
  ScriptExecutionResult,
  StatementQueryResult,
  SchemaResponse,
  TestConnectionResponse
} from "@cqlstudio/shared";
import { createCassandraClient } from "./CassandraClientFactory.js";
import { AppError, mapCassandraError } from "./CassandraErrors.js";
import { mapQueryResult } from "./CassandraMapper.js";

function splitCqlStatements(input: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (inLineComment) {
      current += char;
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && char === "-" && next === "-") {
      current += char + next;
      i += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && char === "/" && next === "*") {
      current += char + next;
      i += 1;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (char === ";" && !inSingleQuote) {
      const statement = current.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

function parseUseKeyspace(statement: string): string | null {
  const match = statement.match(/^\s*use\s+((?:"[^"]+")|(?:[a-zA-Z0-9_]+))\s*$/i);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }

  return raw;
}

export class CassandraService {
  public async testConnection(connection: ConnectionRequest): Promise<TestConnectionResponse> {
    const started = performance.now();
    const client = createCassandraClient(connection);

    try {
      await client.connect();
      const hosts = client.hosts.values();
      const firstHost = hosts.length > 0 ? hosts[0] : undefined;

      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        serverVersion: firstHost?.cassandraVersion
      };
    } catch (error) {
      throw mapCassandraError(error);
    } finally {
      await client.shutdown();
    }
  }

  public async createConnection(connection: ConnectionRequest): Promise<cassandra.Client> {
    const client = createCassandraClient(connection);

    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.shutdown();
      throw mapCassandraError(error);
    }
  }

  public async executeCql(
    client: cassandra.Client,
    cql: string,
    activeKeyspace?: string | null
  ): Promise<StatementQueryResult> {
    const started = performance.now();

    try {
      const options: cassandra.QueryOptions = {
        prepare: false
      };

      if (activeKeyspace) {
        options.keyspace = activeKeyspace;
      }

      const result = await client.execute(cql, [], {
        ...options
      });

      const executionTimeMs = Math.round(performance.now() - started);
      return mapQueryResult(result, cql, executionTimeMs);
    } catch (error) {
      throw mapCassandraError(error);
    }
  }

  public async executeScript(
    client: cassandra.Client,
    cql: string,
    initialKeyspace?: string | null
  ): Promise<{ result: QueryExecutionResult; activeKeyspace: string | null }> {
    const statements = splitCqlStatements(cql);
    let activeKeyspace = initialKeyspace ?? null;

    if (statements.length === 0) {
      throw new AppError(400, "EMPTY_CQL", "Please enter at least one CQL statement.");
    }

    if (statements.length === 1) {
      const singleStatement = statements[0];
      const nextKeyspace = parseUseKeyspace(singleStatement);
      const result = await this.executeCql(client, singleStatement, activeKeyspace);

      if (nextKeyspace) {
        activeKeyspace = nextKeyspace;
      }

      const resultWithContext = {
        ...result,
        activeKeyspace
      };

      return {
        result: resultWithContext,
        activeKeyspace
      };
    }

    const started = performance.now();
    const executed: ScriptExecutionResult["statements"] = [];

    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      try {
        const nextKeyspace = parseUseKeyspace(statement);
        const result = await this.executeCql(client, statement, activeKeyspace);
        if (nextKeyspace) {
          activeKeyspace = nextKeyspace;
        }

        executed.push({
          index: index + 1,
          cql: statement,
          result
        });
      } catch (error) {
        const mapped = mapCassandraError(error);
        throw new AppError(
          mapped.statusCode,
          mapped.code,
          mapped.message,
          {
            ...(mapped.details ?? {}),
            statementIndex: index + 1,
            statementPreview: statement.slice(0, 200)
          },
          mapped.retryable
        );
      }
    }

    return {
      result: {
        statementType: "SCRIPT",
        statementCount: executed.length,
        executionTimeMs: Math.round(performance.now() - started),
        statements: executed,
        activeKeyspace
      },
      activeKeyspace
    };
  }

  public async getSchema(client: cassandra.Client): Promise<SchemaResponse> {
    try {
      const keyspacesResult = await client.execute("SELECT keyspace_name FROM system_schema.keyspaces");
      const tablesResult = await client.execute("SELECT keyspace_name, table_name FROM system_schema.tables");
      const columnsResult = await client.execute(
        "SELECT keyspace_name, table_name, column_name, type, kind, position, clustering_order FROM system_schema.columns"
      );

      const keyspaceNames = new Set<string>();
      for (const row of keyspacesResult.rows) {
        const keyspaceName = (row as unknown as Record<string, unknown>).keyspace_name;
        if (typeof keyspaceName === "string" && keyspaceName.length > 0 && !keyspaceName.startsWith("system")) {
          keyspaceNames.add(keyspaceName);
        }
      }

      const tablesByKeyspace = new Map<string, Set<string>>();
      for (const row of tablesResult.rows) {
        const record = row as unknown as Record<string, unknown>;
        const keyspaceName = record.keyspace_name;
        const tableName = record.table_name;

        if (typeof keyspaceName !== "string" || typeof tableName !== "string") {
          continue;
        }

        if (!keyspaceNames.has(keyspaceName)) {
          continue;
        }

        const tables = tablesByKeyspace.get(keyspaceName) ?? new Set<string>();
        tables.add(tableName);
        tablesByKeyspace.set(keyspaceName, tables);
      }

      const columnsByTable = new Map<
        string,
        Array<{
          name: string;
          type: string;
          isPrimaryKey: boolean;
          isPartitionKey: boolean;
          isClusteringColumn: boolean;
          keyPosition: number | null;
          clusteringOrder: "ASC" | "DESC" | null;
          isStatic: boolean;
        }>
      >();
      for (const row of columnsResult.rows) {
        const record = row as unknown as Record<string, unknown>;
        const keyspaceName = record.keyspace_name;
        const tableName = record.table_name;
        const columnName = record.column_name;
        const columnType = record.type;
        const kind = record.kind;
        const position = record.position;
        const clusteringOrderValue = record.clustering_order;

        if (
          typeof keyspaceName !== "string" ||
          typeof tableName !== "string" ||
          typeof columnName !== "string" ||
          typeof columnType !== "string" ||
          typeof kind !== "string"
        ) {
          continue;
        }

        if (!keyspaceNames.has(keyspaceName)) {
          continue;
        }

        const key = `${keyspaceName}.${tableName}`;
        const columns = columnsByTable.get(key) ?? [];
        const isPartitionKey = kind === "partition_key";
        const isClusteringColumn = kind === "clustering";
        const isStatic = kind === "static";
        const keyPosition = typeof position === "number" ? position : null;
        const clusteringOrder =
          clusteringOrderValue === "desc"
            ? "DESC"
            : clusteringOrderValue === "asc"
              ? "ASC"
              : null;
        columns.push({
          name: columnName,
          type: columnType,
          isPrimaryKey: isPartitionKey || isClusteringColumn,
          isPartitionKey,
          isClusteringColumn,
          keyPosition,
          clusteringOrder,
          isStatic
        });
        columnsByTable.set(key, columns);
      }

      const keyspaces = [...keyspaceNames]
        .sort((a, b) => a.localeCompare(b))
        .map((keyspaceName) => {
          const tableNames = [...(tablesByKeyspace.get(keyspaceName) ?? new Set<string>())].sort((a, b) =>
            a.localeCompare(b)
          );

          return {
            name: keyspaceName,
            tables: tableNames.map((tableName) => {
              const columns = [...(columnsByTable.get(`${keyspaceName}.${tableName}`) ?? [])].sort((a, b) => {
                const group = (column: {
                  isPartitionKey: boolean;
                  isClusteringColumn: boolean;
                  isStatic: boolean;
                }): number => {
                  if (column.isPartitionKey) {
                    return 0;
                  }

                  if (column.isClusteringColumn) {
                    return 1;
                  }

                  if (column.isStatic) {
                    return 2;
                  }

                  return 3;
                };

                const groupDiff = group(a) - group(b);
                if (groupDiff !== 0) {
                  return groupDiff;
                }

                if ((a.isPartitionKey || a.isClusteringColumn) && (b.isPartitionKey || b.isClusteringColumn)) {
                  const posA = a.keyPosition ?? Number.MAX_SAFE_INTEGER;
                  const posB = b.keyPosition ?? Number.MAX_SAFE_INTEGER;
                  if (posA !== posB) {
                    return posA - posB;
                  }
                }

                return a.name.localeCompare(b.name);
              });

              return {
                name: tableName,
                columns
              };
            })
          };
        });

      return { keyspaces };
    } catch (error) {
      throw mapCassandraError(error);
    }
  }
}
