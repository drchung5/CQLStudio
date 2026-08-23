import Editor from "@monaco-editor/react";
import { useEffect } from "react";
import type * as MonacoEditor from "monaco-editor";
import type { SchemaResponse } from "@cqlstudio/shared";

const CQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "LIMIT",
  "ORDER BY",
  "GROUP BY",
  "ALLOW FILTERING",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "BEGIN BATCH",
  "APPLY BATCH",
  "CREATE KEYSPACE",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "DROP KEYSPACE",
  "TRUNCATE",
  "USE",
  "DESCRIBE TABLES",
  "DESCRIBE KEYSPACE"
];

const CQL_FUNCTIONS = ["now", "toTimestamp", "uuid", "writetime", "ttl", "token", "dateOf", "unixTimestampOf"];

interface ResolvedTable {
  keyspaceName: string;
  tableName: string;
  columns: string[];
}

interface CompletionContext {
  schema: SchemaResponse | null;
  activeKeyspace: string | null;
}

const completionContext: CompletionContext = {
  schema: null,
  activeKeyspace: null
};

let completionProviderDisposable: MonacoEditor.IDisposable | null = null;

function getCurrentStatement(textUntilCursor: string): string {
  const statements = textUntilCursor.split(";");
  return statements[statements.length - 1] ?? textUntilCursor;
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/^"|"$/g, "");
}

function resolveTableFromStatement(
  statement: string,
  schema: SchemaResponse | null,
  activeKeyspace: string | null
): ResolvedTable | null {
  if (!schema) {
    return null;
  }

  const match = statement.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_".]+)/i);
  if (!match) {
    return null;
  }

  const rawTableRef = normalizeIdentifier(match[1]);
  const [firstPart, secondPart] = rawTableRef.split(".").map((part) => normalizeIdentifier(part));

  const keyspaceName = secondPart ? firstPart : activeKeyspace;
  const tableName = secondPart ?? firstPart;

  if (!keyspaceName || !tableName) {
    return null;
  }

  const keyspace = schema.keyspaces.find((item) => item.name === keyspaceName);
  const table = keyspace?.tables.find((item) => item.name === tableName);
  if (!table) {
    return null;
  }

  return {
    keyspaceName,
    tableName,
    columns: table.columns.map((column) => column.name)
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

interface CqlEditorPanelProps {
  value: string;
  running: boolean;
  heightPx: number;
  activeKeyspace: string | null;
  schema: SchemaResponse | null;
  title?: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function CqlEditorPanel({
  value,
  running,
  heightPx,
  activeKeyspace,
  schema,
  title,
  onChange,
  onRun
}: CqlEditorPanelProps) {
  useEffect(() => {
    completionContext.schema = schema;
  }, [schema]);

  useEffect(() => {
    completionContext.activeKeyspace = activeKeyspace;
  }, [activeKeyspace]);

  return (
    <section className="editor-panel">
      <div className="editor-toolbar">
        <div className="editor-toolbar-title">
          <h3>{title ?? "CQL Editor"}</h3>
          <p className="editor-keyspace">
            Keyspace: <strong>{activeKeyspace ?? "(none)"}</strong>
          </p>
        </div>
        <button onClick={onRun} disabled={running} className="primary">
          {running ? "Running..." : "Run"}
        </button>
      </div>
      <Editor
        height={`${heightPx}px`}
        defaultLanguage="sql"
        value={value}
        onChange={(next) => onChange(next ?? "")}
        onMount={(editor, monaco) => {
          if (!completionProviderDisposable) {
            completionProviderDisposable = monaco.languages.registerCompletionItemProvider("sql", {
              triggerCharacters: [" ", "."],
              provideCompletionItems: (model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) => {
                const textUntilCursor = model.getValueInRange({
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column
                });

                const statement = getCurrentStatement(textUntilCursor);
                const statementUpper = statement.toUpperCase();
                const currentSchema = completionContext.schema;
                const currentKeyspace = completionContext.activeKeyspace;
                const word = model.getWordUntilPosition(position);
                const range = {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn
                };

                const keywordSuggestions = CQL_KEYWORDS.map((keyword) => ({
                  label: keyword,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: keyword,
                  range
                }));

                const functionSuggestions = CQL_FUNCTIONS.map((fn) => ({
                  label: fn,
                  kind: monaco.languages.CompletionItemKind.Function,
                  insertText: `${fn}()`,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range
                }));

                const keyspaceNames = currentSchema ? currentSchema.keyspaces.map((keyspace) => keyspace.name) : [];
                const keyspaceSuggestions = keyspaceNames.map((keyspaceName) => ({
                  label: keyspaceName,
                  kind: monaco.languages.CompletionItemKind.Module,
                  insertText: keyspaceName,
                  range,
                  detail: "Keyspace"
                }));

                const activeTables =
                  currentSchema && currentKeyspace
                    ? currentSchema.keyspaces.find((keyspace) => keyspace.name === currentKeyspace)?.tables ?? []
                    : [];
                const activeTableSuggestions = activeTables.map((table) => ({
                  label: table.name,
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: table.name,
                  range,
                  detail: `Table (${currentKeyspace ?? "no keyspace"})`
                }));

                const qualifiedTableSuggestions =
                  currentSchema?.keyspaces.flatMap((keyspace) =>
                    keyspace.tables.map((table) => ({
                      label: `${keyspace.name}.${table.name}`,
                      kind: monaco.languages.CompletionItemKind.Class,
                      insertText: `${keyspace.name}.${table.name}`,
                      range,
                      detail: "Qualified table"
                    }))
                  ) ?? [];

                const resolvedTable = resolveTableFromStatement(statement, currentSchema, currentKeyspace);
                const columnSuggestions = (resolvedTable?.columns ?? []).map((columnName) => ({
                  label: columnName,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: columnName,
                  range,
                  detail: `Column (${resolvedTable?.tableName ?? "table"})`
                }));

                const allColumns =
                  currentSchema && currentKeyspace
                    ? unique(
                        (currentSchema.keyspaces.find((keyspace) => keyspace.name === currentKeyspace)?.tables ?? []).flatMap(
                          (table) => table.columns.map((column) => column.name)
                        )
                      )
                    : [];
                const allColumnSuggestions = allColumns.map((columnName) => ({
                  label: columnName,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: columnName,
                  range,
                  detail: "Column"
                }));

                const useContext = /\bUSE\s+[a-zA-Z0-9_".]*$/i.test(statement);
                const tableContext = /\b(?:FROM|INTO|UPDATE|TABLE)\s+[a-zA-Z0-9_".]*$/i.test(statement);
                const whereOrSetContext = /\b(?:WHERE|SET)\s+[a-zA-Z0-9_",=.\s]*$/i.test(statement);
                const selectBeforeFromContext = /\bSELECT\b/i.test(statementUpper) && !/\bFROM\b/i.test(statementUpper);

                if (useContext) {
                  return { suggestions: keyspaceSuggestions };
                }

                if (tableContext) {
                  return {
                    suggestions: [...activeTableSuggestions, ...qualifiedTableSuggestions]
                  };
                }

                if (whereOrSetContext || selectBeforeFromContext) {
                  return {
                    suggestions: [...columnSuggestions, ...allColumnSuggestions, ...functionSuggestions]
                  };
                }

                return {
                  suggestions: [
                    ...keywordSuggestions,
                    ...functionSuggestions,
                    ...activeTableSuggestions,
                    ...columnSuggestions,
                    ...keyspaceSuggestions
                  ]
                };
              }
            });
          }

          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            onRun();
          });
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: "on"
        }}
      />
      <p className="hint">Shortcut: Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)</p>
    </section>
  );
}
