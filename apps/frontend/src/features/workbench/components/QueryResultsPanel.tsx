import type { QueryExecutionResult, StatementQueryResult } from "@cqlstudio/shared";

interface QueryResultsPanelProps {
  result: QueryExecutionResult | null;
  hideHeader?: boolean;
}

function splitByTopLevelComma(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

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

    if (!inSingleQuote) {
      if (char === "(") {
        parenDepth += 1;
      } else if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }

      const isTopLevel = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
      if (char === "," && isTopLevel) {
        const part = current.trim();
        if (part) {
          parts.push(part);
        }
        current = "";
        continue;
      }
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    parts.push(trailing);
  }

  return parts;
}

function splitByTopLevelAnd(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

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

    if (!inSingleQuote) {
      if (char === "(") {
        parenDepth += 1;
      } else if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }

      const isTopLevel = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
      const maybeAnd = input.slice(i, i + 3).toUpperCase();
      const prev = i > 0 ? input[i - 1] : " ";
      const after = i + 3 < input.length ? input[i + 3] : " ";
      const bounded = /\s|\(|\{|\[/.test(prev) && /\s|\)|\}|\]|$/.test(after);

      if (isTopLevel && maybeAnd === "AND" && bounded) {
        const part = current.trim();
        if (part) {
          parts.push(part);
        }
        current = "";
        i += 2;
        continue;
      }
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    parts.push(trailing);
  }

  return parts;
}

function prettyPrintCreateStatement(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const openParen = normalized.indexOf("(");
  if (openParen < 0) {
    return raw;
  }

  let closeParen = -1;
  let depth = 0;
  let inSingleQuote = false;
  for (let i = openParen; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = i + 1 < normalized.length ? normalized[i + 1] : "";

    if (char === "'") {
      if (inSingleQuote && next === "'") {
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          closeParen = i;
          break;
        }
      }
    }
  }

  if (closeParen < 0) {
    return raw;
  }

  const head = normalized.slice(0, openParen).trim();
  const columnBody = normalized.slice(openParen + 1, closeParen).trim();
  const tail = normalized.slice(closeParen + 1).trim();

  const columns = splitByTopLevelComma(columnBody);
  const prettyColumns = columns.length > 0 ? `\n  ${columns.join(",\n  ")}\n` : "\n";

  if (!tail) {
    return `${head} (${prettyColumns})`;
  }

  const withMatch = tail.match(/^WITH\s+(.+)$/i);
  if (!withMatch) {
    return `${head} (${prettyColumns}) ${tail}`;
  }

  const options = splitByTopLevelAnd(withMatch[1]);
  if (options.length === 0) {
    return `${head} (${prettyColumns})\nWITH ${withMatch[1]}`;
  }

  return `${head} (${prettyColumns})\nWITH ${options[0]}${options
    .slice(1)
    .map((item) => `\n  AND ${item}`)
    .join("")}`;
}

function renderCellValue(value: unknown, columnName?: string): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (columnName === "create_statement" && typeof value === "string") {
    return prettyPrintCreateStatement(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function QueryResultsPanel({ result, hideHeader = true }: QueryResultsPanelProps) {
  const renderStatementResult = (statementResult: StatementQueryResult, prefix?: string) => (
    <div className="script-statement-result">
      {prefix && <p className="meta script-title">{prefix}</p>}

      {statementResult.statementType === "SELECT" && (
        <>
          <p className="meta">Rows returned: {statementResult.rowCount}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {statementResult.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statementResult.rows.map((row, index) => (
                  <tr key={index}>
                    {statementResult.columns.map((column) => (
                      <td
                        key={`${index}-${column}`}
                        className={column === "create_statement" ? "cql-create-statement-cell" : undefined}
                      >
                        {renderCellValue(row[column], column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {statementResult.statementType === "NON_SELECT" && (
        <p className="meta">
          {statementResult.message}
          {typeof statementResult.applied === "boolean" ? ` (applied: ${String(statementResult.applied)})` : ""}
        </p>
      )}
    </div>
  );

  return (
    <section className="results-panel">
      {!hideHeader && <h3>Results</h3>}
      {!result && <p>Run a CQL statement to see results.</p>}

      {result?.statementType === "SCRIPT" && (
        <>
          <p className="meta">Executed {result.statementCount} statements.</p>
          {result.statements.map((statement) =>
            renderStatementResult(statement.result, `Statement ${statement.index}: ${statement.cql}`)
          )}
        </>
      )}

      {result && result.statementType !== "SCRIPT" && renderStatementResult(result)}
    </section>
  );
}
