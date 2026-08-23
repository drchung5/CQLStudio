import type { QueryExecutionResult, StatementQueryResult } from "@cqlstudio/shared";

interface QueryResultsPanelProps {
  result: QueryExecutionResult | null;
  hideHeader?: boolean;
}

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
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
                      <td key={`${index}-${column}`}>{renderCellValue(row[column])}</td>
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
