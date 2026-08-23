import { useEffect, useRef, useState } from "react";
import type { QueryExecutionResult, SchemaResponse } from "@cqlstudio/shared";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { getSchema } from "../../api/schemaApi";
import { executeQuery } from "../../api/queryApi";
import { ApiClientError } from "../../api/client";
import { disconnect } from "../../api/connectionApi";
import { CqlEditorPanel } from "./components/CqlEditorPanel";
import { ExecutionStatusBar } from "./components/ExecutionStatusBar";
import { QueryResultsPanel } from "./components/QueryResultsPanel";
import { SchemaBrowser } from "./components/SchemaBrowser";
import type { ExecutionState, WorkbenchCellState } from "./types/workbenchTypes";

interface WorkbenchPageProps {
  sessionId: string;
  connectionName: string;
  onDisconnect: () => void;
}

const initialCql = "SELECT now() FROM system.local;";
const NOTEBOOK_STORAGE_KEY = "cqlstudio:notebook:v1";

type ResizeMode =
  | {
      kind: "schema";
    }
  | {
      kind: "cell-editor";
      cellId: string;
      startY: number;
      startHeightPx: number;
    }
  | null;

const MIN_SCHEMA_WIDTH = 220;
const MAX_SCHEMA_WIDTH = 520;
const MIN_CELL_EDITOR_HEIGHT = 72;
const MAX_CELL_EDITOR_HEIGHT = 700;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCellId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function createCqlCell(name: string, content = "", initialExecution?: ExecutionState): WorkbenchCellState {
  const id = createCellId();
  return {
    id,
    name,
    cellType: "cql",
    markdownViewMode: "edit",
    content,
    result: null,
    editorHeightPx: 280,
    statusMinimized: false,
    resultsMinimized: false,
    execution:
      initialExecution ?? {
        status: "idle",
        message: "Ready."
      }
  };
}

function createMarkdownCell(name: string, content = "# Notes\n"): WorkbenchCellState {
  const id = createCellId();
  return {
    id,
    name,
    cellType: "markdown",
    markdownViewMode: "edit",
    content,
    result: null,
    editorHeightPx: 220,
    statusMinimized: true,
    resultsMinimized: true,
    execution: {
      status: "idle",
      message: "Markdown cell"
    }
  };
}

function isCellLike(value: unknown): value is Partial<WorkbenchCellState> {
  return typeof value === "object" && value !== null;
}

function renderMarkdownToHtml(markdown: string): string {
  const parsed = marked.parse(markdown);
  const html = typeof parsed === "string" ? parsed : "";
  return DOMPurify.sanitize(html);
}

function loadPersistedCells(): WorkbenchCellState[] {
  if (typeof window === "undefined") {
    return [
      createCqlCell("Cell 1", initialCql, {
        status: "idle",
        message: "Ready."
      })
    ];
  }

  try {
    const raw = window.localStorage.getItem(NOTEBOOK_STORAGE_KEY);
    if (!raw) {
      return [
        createCqlCell("Cell 1", initialCql, {
          status: "idle",
          message: "Ready."
        })
      ];
    }

    const parsed = JSON.parse(raw) as { cells?: unknown[] };
    if (!Array.isArray(parsed.cells) || parsed.cells.length === 0) {
      return [
        createCqlCell("Cell 1", initialCql, {
          status: "idle",
          message: "Ready."
        })
      ];
    }

    const hydrated = parsed.cells
      .filter(isCellLike)
      .map((cell, index) => {
        const type = cell.cellType === "markdown" ? "markdown" : "cql";
        const legacyContent =
          typeof (cell as { cql?: unknown }).cql === "string" ? ((cell as { cql?: string }).cql ?? "") : "";
        const content = typeof cell.content === "string" ? cell.content : legacyContent;

        return {
          id: typeof cell.id === "string" ? cell.id : createCellId(),
          name: typeof cell.name === "string" ? cell.name : `Cell ${index + 1}`,
          cellType: type,
          markdownViewMode: cell.markdownViewMode === "preview" ? "preview" : "edit",
          content,
          result: cell.result ?? null,
          execution:
            cell.execution &&
            typeof cell.execution === "object" &&
            "status" in cell.execution &&
            "message" in cell.execution
              ? (cell.execution as ExecutionState)
              : {
                  status: "idle",
                  message: type === "markdown" ? "Markdown cell" : "Ready."
                },
          editorHeightPx:
            typeof cell.editorHeightPx === "number"
              ? clamp(cell.editorHeightPx, MIN_CELL_EDITOR_HEIGHT, MAX_CELL_EDITOR_HEIGHT)
              : type === "markdown"
                ? 220
                : 280,
          statusMinimized: typeof cell.statusMinimized === "boolean" ? cell.statusMinimized : type === "markdown",
          resultsMinimized: typeof cell.resultsMinimized === "boolean" ? cell.resultsMinimized : type === "markdown"
        } satisfies WorkbenchCellState;
      });

    return hydrated.length > 0
      ? hydrated
      : [
          createCqlCell("Cell 1", initialCql, {
            status: "idle",
            message: "Ready."
          })
        ];
  } catch {
    return [
      createCqlCell("Cell 1", initialCql, {
        status: "idle",
        message: "Ready."
      })
    ];
  }
}

export function WorkbenchPage({ sessionId, connectionName, onDisconnect }: WorkbenchPageProps) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [cells, setCells] = useState<WorkbenchCellState[]>(() => loadPersistedCells());
  const [activeKeyspace, setActiveKeyspace] = useState<string | null>(null);
  const [schemaWidthPx, setSchemaWidthPx] = useState(280);
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [resizeMode, setResizeMode] = useState<ResizeMode>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const anyCellRunning = cells.some((cell) => cell.cellType === "cql" && cell.execution.status === "running");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const cellsToPersist = cells.map((cell) => ({
      id: cell.id,
      name: cell.name,
      cellType: cell.cellType,
      markdownViewMode: cell.markdownViewMode,
      content: cell.content,
      editorHeightPx: cell.editorHeightPx,
      statusMinimized: cell.statusMinimized,
      resultsMinimized: cell.resultsMinimized
    }));

    window.localStorage.setItem(
      NOTEBOOK_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cells: cellsToPersist
      })
    );
  }, [cells]);

  const updateCell = (cellId: string, updater: (cell: WorkbenchCellState) => WorkbenchCellState): void => {
    setCells((prev) => prev.map((cell) => (cell.id === cellId ? updater(cell) : cell)));
  };

  const updateCellEditorHeight = (cellId: string, heightPx: number): void => {
    setCells((prev) =>
      prev.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              editorHeightPx: heightPx
            }
          : cell
      )
    );
  };

  const loadSchema = async () => {
    try {
      setSchemaLoading(true);
      setSchemaMessage(null);
      const nextSchema = await getSchema(sessionId);
      setSchema(nextSchema);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Failed to load schema.";
      setSchemaMessage(message);
    } finally {
      setSchemaLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setSchemaLoading(true);
        const nextSchema = await getSchema(sessionId);
        if (!cancelled) {
          setSchema(nextSchema);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof ApiClientError ? error.message : "Failed to load schema.";
          setSchemaMessage(message);
        }
      } finally {
        if (!cancelled) {
          setSchemaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!resizeMode) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (resizeMode.kind === "schema") {
        const gridRect = gridRef.current?.getBoundingClientRect();
        if (!gridRect) {
          return;
        }

        const nextWidth = clamp(event.clientX - gridRect.left, MIN_SCHEMA_WIDTH, MAX_SCHEMA_WIDTH);
        setSchemaWidthPx(nextWidth);
        return;
      }

      if (resizeMode.kind === "cell-editor") {
        const deltaY = event.clientY - resizeMode.startY;
        const nextHeight = clamp(
          resizeMode.startHeightPx + deltaY,
          MIN_CELL_EDITOR_HEIGHT,
          MAX_CELL_EDITOR_HEIGHT
        );
        updateCellEditorHeight(resizeMode.cellId, nextHeight);
      }
    };

    const onMouseUp = () => {
      setResizeMode(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.classList.add("resizing");

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("resizing");
    };
  }, [resizeMode]);

  const runCell = async (cellId: string) => {
    const targetCell = cells.find((cell) => cell.id === cellId);
    if (!targetCell || targetCell.cellType !== "cql") {
      return;
    }

    if (!targetCell.content.trim()) {
      updateCell(cellId, (cell) => ({
        ...cell,
        execution: {
          status: "error",
          message: "Please enter a CQL statement."
        }
      }));
      return;
    }

    try {
      updateCell(cellId, (cell) => ({
        ...cell,
        execution: {
          status: "running",
          message: "Executing statement..."
        }
      }));

      const nextResult: QueryExecutionResult = await executeQuery(sessionId, targetCell.content);
      setActiveKeyspace(nextResult.activeKeyspace ?? null);

      updateCell(cellId, (cell) => ({
        ...cell,
        result: nextResult,
        execution: {
          status: "success",
          message:
            nextResult.statementType === "SCRIPT"
              ? `Executed ${nextResult.statementCount} statements.`
              : nextResult.statementType === "SELECT"
                ? "SELECT completed."
                : "Statement completed.",
          timeMs: nextResult.executionTimeMs
        }
      }));
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Execution failed.";
      updateCell(cellId, (cell) => ({
        ...cell,
        execution: {
          status: "error",
          message
        }
      }));
    }
  };

  const addCell = () => {
    setCells((prev) => [...prev, createCqlCell(`Cell ${prev.length + 1}`)]);
  };

  const addMarkdownCell = () => {
    setCells((prev) => [...prev, createMarkdownCell(`Markdown ${prev.length + 1}`)]);
  };

  const removeCell = (cellId: string) => {
    setCells((prev) => {
      if (prev.length === 1) {
        return prev;
      }

      return prev.filter((cell) => cell.id !== cellId);
    });
  };

  const handleDisconnect = async () => {
    try {
      await disconnect(sessionId);
    } finally {
      onDisconnect();
    }
  };

  return (
    <section className="workbench">
      <header className="workbench-header">
        <div>
          <h2>Workbench</h2>
          <p>Connected: {connectionName}</p>
        </div>
        <div className="workbench-header-actions">
          <button onClick={() => void loadSchema()} disabled={schemaLoading || anyCellRunning}>
            {schemaLoading ? "Refreshing..." : "Refresh Schema"}
          </button>
          <button onClick={addCell} disabled={anyCellRunning}>
            Add CQL Cell
          </button>
          <button onClick={addMarkdownCell} disabled={anyCellRunning}>
            Add Markdown Cell
          </button>
          <button onClick={() => void handleDisconnect()}>Disconnect</button>
        </div>
      </header>
      {schemaMessage && <p className="workbench-message error">{schemaMessage}</p>}

      <div
        className="workbench-grid"
        ref={gridRef}
        style={{
          gridTemplateColumns: `${schemaWidthPx}px 10px minmax(0, 1fr)`
        }}
      >
        <SchemaBrowser schema={schema} loading={schemaLoading} />
        <div
          className="splitter splitter-vertical"
          onMouseDown={() => {
            setResizeMode({ kind: "schema" });
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize schema pane"
        />
        <main className="workbench-main">
          <div className="workbench-cells-list">
            {cells.map((cell, index) => (
              <section
                className={`workbench-cell${cell.statusMinimized && cell.resultsMinimized ? " both-minimized" : ""}`}
                key={cell.id}
              >
                <div className="workbench-cell-header">
                  <input
                    className="workbench-cell-name"
                    value={cell.name}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      updateCell(cell.id, (current) => ({
                        ...current,
                        name: nextName
                      }));
                    }}
                    placeholder={`Cell ${index + 1}`}
                    aria-label={`Name for cell ${index + 1}`}
                  />
                  <button onClick={() => removeCell(cell.id)} disabled={cells.length === 1 || anyCellRunning}>
                    Remove
                  </button>
                </div>
                {cell.cellType === "cql" && (
                  <>
                    <CqlEditorPanel
                      title={`CQL Editor - ${cell.name.trim() || `Cell ${index + 1}`}`}
                      value={cell.content}
                      onChange={(next) => {
                        updateCell(cell.id, (current) => ({
                          ...current,
                          content: next
                        }));
                      }}
                      running={cell.execution.status === "running"}
                      onRun={() => void runCell(cell.id)}
                      heightPx={cell.editorHeightPx}
                      activeKeyspace={activeKeyspace}
                      schema={schema}
                    />
                    <div
                      className="splitter splitter-horizontal"
                      onMouseDown={(event) => {
                        setResizeMode({
                          kind: "cell-editor",
                          cellId: cell.id,
                          startY: event.clientY,
                          startHeightPx: cell.editorHeightPx
                        });
                      }}
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label={`Resize cell ${index + 1} editor`}
                    />
                    <section className={`cell-subpanel${cell.statusMinimized ? " minimized" : ""}`}>
                      <div className="cell-subpanel-header">
                        <h4>Status</h4>
                        <button
                          onClick={() => {
                            updateCell(cell.id, (current) => ({
                              ...current,
                              statusMinimized: !current.statusMinimized
                            }));
                          }}
                          disabled={cell.execution.status === "running"}
                        >
                          {cell.statusMinimized ? "Expand" : "Minimize"}
                        </button>
                      </div>
                      {!cell.statusMinimized && <ExecutionStatusBar execution={cell.execution} />}
                    </section>

                    <section className={`cell-subpanel${cell.resultsMinimized ? " minimized" : ""}`}>
                      <div className="cell-subpanel-header">
                        <h4>Results</h4>
                        <button
                          onClick={() => {
                            updateCell(cell.id, (current) => ({
                              ...current,
                              resultsMinimized: !current.resultsMinimized
                            }));
                          }}
                        >
                          {cell.resultsMinimized ? "Expand" : "Minimize"}
                        </button>
                      </div>
                      {!cell.resultsMinimized && <QueryResultsPanel result={cell.result} />}
                    </section>
                  </>
                )}

                {cell.cellType === "markdown" && (
                  <>
                    <section className="markdown-editor-panel">
                      <div className="markdown-editor-header">
                        <h4>Markdown</h4>
                        <button
                          onClick={() => {
                            updateCell(cell.id, (current) => ({
                              ...current,
                              markdownViewMode: current.markdownViewMode === "edit" ? "preview" : "edit"
                            }));
                          }}
                        >
                          {cell.markdownViewMode === "edit" ? "Preview" : "Edit"}
                        </button>
                      </div>
                      {cell.markdownViewMode === "edit" ? (
                        <textarea
                          className="markdown-editor-input"
                          value={cell.content}
                          style={{ height: `${cell.editorHeightPx}px` }}
                          onChange={(event) => {
                            const next = event.target.value;
                            updateCell(cell.id, (current) => ({
                              ...current,
                              content: next
                            }));
                          }}
                          placeholder="Write markdown notes..."
                        />
                      ) : (
                        <div
                          className="markdown-preview-body"
                          style={{ minHeight: `${cell.editorHeightPx}px` }}
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdownToHtml(cell.content || "(empty markdown cell)")
                          }}
                        />
                      )}
                    </section>
                    <div
                      className="splitter splitter-horizontal"
                      onMouseDown={(event) => {
                        setResizeMode({
                          kind: "cell-editor",
                          cellId: cell.id,
                          startY: event.clientY,
                          startHeightPx: cell.editorHeightPx
                        });
                      }}
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label={`Resize markdown cell ${index + 1} editor`}
                    />
                  </>
                )}
              </section>
            ))}
          </div>
        </main>
      </div>
    </section>
  );
}
