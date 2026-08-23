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

type GlobalCompletionStore = typeof globalThis & {
  __cqlstudioSqlCompletionProvider?: MonacoEditor.IDisposable;
};

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

function dedupeCompletions<T extends { label: string | MonacoEditor.languages.CompletionItemLabel }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const label = typeof item.label === "string" ? item.label : item.label.label;
    if (seen.has(label)) {
      return false;
    }
    seen.add(label);
    return true;
  });
}

interface CqlEditorPanelProps {
  cellName: string;
  editingName: boolean;
  nameDraft: string;
  renameDisabled?: boolean;
  value: string;
  running: boolean;
  heightPx: number;
  activeKeyspace: string | null;
  schema: SchemaResponse | null;
  onStartRename: () => void;
  onNameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onChange: (value: string) => void;
  onRun: () => void;
  onRemove: () => void;
}

export function CqlEditorPanel({
  cellName,
  editingName,
  nameDraft,
  renameDisabled = false,
  value,
  running,
  heightPx,
  activeKeyspace,
  schema,
  onStartRename,
  onNameDraftChange,
  onCommitRename,
  onCancelRename,
  onChange,
  onRun,
  onRemove
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
          <div className="editor-title-row">
            {editingName ? (
              <>
                <span className="editor-title-prefix">CQL -</span>
                <input
                  className="inline-name-input editor-inline-name-input"
                  value={nameDraft}
                  onChange={(event) => {
                    onNameDraftChange(event.target.value);
                  }}
                  onBlur={onCommitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onCommitRename();
                    }

                    if (event.key === "Escape") {
                      onCancelRename();
                    }
                  }}
                  autoFocus
                  aria-label="Edit CQL cell name"
                />
              </>
            ) : (
              <>
                <h3>{`CQL - ${cellName.trim() || "Untitled Cell"}`}</h3>
                <button
                  className="name-edit-button"
                  onClick={onStartRename}
                  disabled={renameDisabled}
                  aria-label="Edit CQL cell name"
                >
                  <svg className="name-edit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm18-11.5a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75L21 5.75z" />
                  </svg>
                </button>
              </>
            )}
          </div>
          <p className="editor-keyspace">
            Keyspace: <strong>{activeKeyspace ?? "(none)"}</strong>
          </p>
        </div>
        <div className="editor-toolbar-actions">
          <button onClick={onRun} disabled={running} className="primary">
            {running ? "Running..." : "Run"}
          </button>
          <button onClick={onRemove} disabled={running}>
            Remove
          </button>
        </div>
      </div>
      <Editor
        width="100%"
        height={`${heightPx}px`}
        defaultLanguage="sql"
        value={value}
        onChange={(next) => onChange(next ?? "")}
        onMount={(editor, monaco) => {
          const completionStore = globalThis as GlobalCompletionStore;

          if (!completionStore.__cqlstudioSqlCompletionProvider) {
            completionStore.__cqlstudioSqlCompletionProvider = monaco.languages.registerCompletionItemProvider("sql", {
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
                  return { suggestions: dedupeCompletions(keyspaceSuggestions) };
                }

                if (tableContext) {
                  return {
                    suggestions: dedupeCompletions([...activeTableSuggestions, ...qualifiedTableSuggestions])
                  };
                }

                if (whereOrSetContext || selectBeforeFromContext) {
                  return {
                    suggestions: dedupeCompletions([...columnSuggestions, ...allColumnSuggestions, ...functionSuggestions])
                  };
                }

                return {
                  suggestions: dedupeCompletions([
                    ...keywordSuggestions,
                    ...functionSuggestions,
                    ...activeTableSuggestions,
                    ...columnSuggestions,
                    ...keyspaceSuggestions
                  ])
                };
              }
            });
          }

          completionProviderDisposable = completionStore.__cqlstudioSqlCompletionProvider ?? null;

          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            onRun();
          });
        }}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: "on",
          padding: {
            top: 8,
            bottom: 6
          }
        }}
      />
      <p className="hint">Shortcut: Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)</p>
    </section>
  );
}
