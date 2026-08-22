import type { SchemaResponse } from "@cqlstudio/shared";

interface SchemaBrowserProps {
  schema: SchemaResponse | null;
  loading: boolean;
}

interface ChabotkoMarker {
  text: string;
  arrow: "ASC" | "DESC" | null;
}

function getChabotkoMarker(column: {
  isPrimaryKey: boolean;
  isPartitionKey: boolean;
  isClusteringColumn: boolean;
  keyPosition: number | null;
  clusteringOrder: "ASC" | "DESC" | null;
}): ChabotkoMarker | null {
  if (column.isPartitionKey) {
    return {
      text: "PK",
      arrow: null
    };
  }

  if (column.isClusteringColumn) {
    const rank = column.keyPosition !== null ? `${column.keyPosition + 1}` : "";
    return {
      text: `CK${rank}`,
      arrow: column.clusteringOrder === "DESC" ? "DESC" : "ASC"
    };
  }

  if (column.isPrimaryKey) {
    return {
      text: "PK",
      arrow: null
    };
  }

  return null;
}

export function SchemaBrowser({ schema, loading }: SchemaBrowserProps) {
  return (
    <aside className="schema-browser">
      <h3>Schema</h3>
      {loading && <p>Loading schema...</p>}
      {!loading && (!schema || schema.keyspaces.length === 0) && <p>No non-system keyspaces found.</p>}
      {!loading && schema && schema.keyspaces.length > 0 && (
        <ul className="schema-tree">
          {schema.keyspaces.map((keyspace) => (
            <li key={keyspace.name}>
              <details className="schema-node keyspace-node">
                <summary>
                  <strong>{keyspace.name}</strong>
                </summary>
                <ul>
                  {keyspace.tables.map((table) => (
                    <li key={table.name}>
                      <details className="schema-node table-node">
                        <summary>{table.name}</summary>
                        <ul>
                          {table.columns.map((column) => {
                            const marker = getChabotkoMarker(column);
                            const leadingMarker = marker ?? (column.isStatic ? { text: "S", arrow: null } : null);
                            return (
                              <li key={column.name}>
                                {leadingMarker && (
                                  <span className="schema-chabotko-mark">
                                    <span>{leadingMarker.text}</span>
                                    {leadingMarker.arrow && (
                                      <span className="schema-chabotko-arrow">
                                        {leadingMarker.arrow === "DESC" ? "▼" : "▲"}
                                      </span>
                                    )}
                                  </span>
                                )}
                                <span>
                                  {column.name}: <em>{column.type}</em>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
