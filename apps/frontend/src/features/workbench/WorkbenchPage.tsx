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
const NOTEBOOK_INDEX_STORAGE_KEY = "cqlstudio:notebooks:index:v1";
const NOTEBOOK_CELLS_STORAGE_PREFIX = "cqlstudio:notebook:cells:v2:";

interface NotebookIndexEntry {
  id: string;
  name: string;
}

interface NotebookIndexPayload {
  activeNotebookId: string;
  notebooks: NotebookIndexEntry[];
}

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

function createNotebook(name: string): NotebookIndexEntry {
  return {
    id: createCellId(),
    name
  };
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

function defaultCells(): WorkbenchCellState[] {
  return [
    createCqlCell("Cell 1", initialCql, {
      status: "idle",
      message: "Ready."
    })
  ];
}

function getNextCellName(cells: WorkbenchCellState[]): string {
  const numericNames = cells
    .map((cell) => {
      const match = cell.name.trim().match(/^Cell\s+(\d+)$/i);
      return match ? Number.parseInt(match[1], 10) : null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const next = numericNames.length > 0 ? Math.max(...numericNames) + 1 : cells.length + 1;
  return `Cell ${next}`;
}

function hydrateCells(rawCells: unknown[]): WorkbenchCellState[] {
  const hydrated = rawCells
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

  return hydrated.length > 0 ? hydrated : defaultCells();
}

function loadNotebookState(): { notebooks: NotebookIndexEntry[]; activeNotebookId: string; initialCells: WorkbenchCellState[] } {
  if (typeof window === "undefined") {
    const fallback = createNotebook("Notebook 1");
    return {
      notebooks: [fallback],
      activeNotebookId: fallback.id,
      initialCells: defaultCells()
    };
  }

  try {
    const indexRaw = window.localStorage.getItem(NOTEBOOK_INDEX_STORAGE_KEY);
    if (indexRaw) {
      const parsedIndex = JSON.parse(indexRaw) as Partial<NotebookIndexPayload>;
      const notebooks = Array.isArray(parsedIndex.notebooks)
        ? parsedIndex.notebooks
            .filter((nb): nb is NotebookIndexEntry => typeof nb?.id === "string" && typeof nb?.name === "string")
            .map((nb) => ({ id: nb.id, name: nb.name }))
        : [];

      if (Array.isArray(parsedIndex.notebooks) && notebooks.length === 0) {
        return {
          notebooks: [],
          activeNotebookId: "",
          initialCells: []
        };
      }

      if (notebooks.length > 0) {
        const activeNotebookId =
          typeof parsedIndex.activeNotebookId === "string" && notebooks.some((nb) => nb.id === parsedIndex.activeNotebookId)
            ? parsedIndex.activeNotebookId
            : notebooks[0].id;

        const cellsRaw = window.localStorage.getItem(`${NOTEBOOK_CELLS_STORAGE_PREFIX}${activeNotebookId}`);
        const cellsParsed = cellsRaw ? (JSON.parse(cellsRaw) as { cells?: unknown[] }) : null;
        const initialCells = cellsParsed?.cells && Array.isArray(cellsParsed.cells) ? hydrateCells(cellsParsed.cells) : defaultCells();

        return {
          notebooks,
          activeNotebookId,
          initialCells
        };
      }
    }

    const legacyRaw = window.localStorage.getItem(NOTEBOOK_STORAGE_KEY);
    if (legacyRaw) {
      const parsedLegacy = JSON.parse(legacyRaw) as { cells?: unknown[] };
      const migratedNotebook = createNotebook("Notebook 1");
      const initialCells = Array.isArray(parsedLegacy.cells) ? hydrateCells(parsedLegacy.cells) : defaultCells();
      return {
        notebooks: [migratedNotebook],
        activeNotebookId: migratedNotebook.id,
        initialCells
      };
    }

    const fallback = createNotebook("Notebook 1");
    return {
      notebooks: [fallback],
      activeNotebookId: fallback.id,
      initialCells: defaultCells()
    };
  } catch {
    const fallback = createNotebook("Notebook 1");
    return {
      notebooks: [fallback],
      activeNotebookId: fallback.id,
      initialCells: defaultCells()
    };
  }
}

export function WorkbenchPage({ sessionId, connectionName, onDisconnect }: WorkbenchPageProps) {
  const [initialNotebookState] = useState(() => loadNotebookState());
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [notebooks, setNotebooks] = useState<NotebookIndexEntry[]>(initialNotebookState.notebooks);
  const [activeNotebookId, setActiveNotebookId] = useState<string>(initialNotebookState.activeNotebookId);
  const [cells, setCells] = useState<WorkbenchCellState[]>(initialNotebookState.initialCells);
  const [activeKeyspace, setActiveKeyspace] = useState<string | null>(null);
  const [schemaWidthPx, setSchemaWidthPx] = useState(280);
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [resizeMode, setResizeMode] = useState<ResizeMode>(null);
  const [showAddCellDialog, setShowAddCellDialog] = useState(false);
  const [newCellType, setNewCellType] = useState<"cql" | "markdown">("cql");
  const [editingNotebookName, setEditingNotebookName] = useState(false);
  const [notebookNameDraft, setNotebookNameDraft] = useState("");
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [cellNameDraft, setCellNameDraft] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);

  const anyCellRunning = cells.some((cell) => cell.cellType === "cql" && cell.execution.status === "running");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      NOTEBOOK_INDEX_STORAGE_KEY,
      JSON.stringify({
        activeNotebookId,
        notebooks
      } satisfies NotebookIndexPayload)
    );
  }, [activeNotebookId, notebooks]);

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
      `${NOTEBOOK_CELLS_STORAGE_PREFIX}${activeNotebookId}`,
      JSON.stringify({
        version: 2,
        cells: cellsToPersist
      })
    );
  }, [activeNotebookId, cells]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!activeNotebookId) {
      setCells([]);
      return;
    }

    const raw = window.localStorage.getItem(`${NOTEBOOK_CELLS_STORAGE_PREFIX}${activeNotebookId}`);
    if (!raw) {
      setCells(defaultCells());
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { cells?: unknown[] };
      if (!Array.isArray(parsed.cells)) {
        setCells(defaultCells());
        return;
      }
      setCells(hydrateCells(parsed.cells));
    } catch {
      setCells(defaultCells());
    }
  }, [activeNotebookId]);

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
    setCells((prev) => [...prev, createCqlCell(getNextCellName(prev))]);
  };

  const addMarkdownCell = () => {
    setCells((prev) => [...prev, createMarkdownCell(getNextCellName(prev))]);
  };

  const openAddCellDialog = () => {
    if (!activeNotebookId) {
      return;
    }

    setNewCellType("cql");
    setShowAddCellDialog(true);
  };

  const confirmAddCell = () => {
    if (newCellType === "markdown") {
      addMarkdownCell();
    } else {
      addCell();
    }
    setShowAddCellDialog(false);
  };

  const removeCell = (cellId: string) => {
    const target = cells.find((cell) => cell.id === cellId);
    const label = target?.name?.trim() || "this cell";
    const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setCells((prev) => prev.filter((cell) => cell.id !== cellId));
  };

  const createNotebookAndSwitch = () => {
    setNotebooks((prev) => {
      const created = createNotebook(`Notebook ${prev.length + 1}`);
      setActiveNotebookId(created.id);
      setCells(defaultCells());
      return [...prev, created];
    });
  };

  const renameActiveNotebook = (name: string) => {
    setNotebooks((prev) => prev.map((nb) => (nb.id === activeNotebookId ? { ...nb, name } : nb)));
  };

  const startNotebookRename = () => {
    setNotebookNameDraft(activeNotebook?.name ?? "");
    setEditingNotebookName(true);
  };

  const commitNotebookRename = () => {
    renameActiveNotebook(notebookNameDraft.trim() || "Untitled Notebook");
    setEditingNotebookName(false);
  };

  const startCellRename = (cellId: string, currentName: string) => {
    setEditingCellId(cellId);
    setCellNameDraft(currentName);
  };

  const commitCellRename = (cellId: string) => {
    updateCell(cellId, (current) => ({
      ...current,
      name: cellNameDraft.trim() || "Untitled Cell"
    }));
    setEditingCellId(null);
  };

  const deleteActiveNotebook = () => {
    if (!activeNotebookId || notebooks.length === 0) {
      return;
    }

    const currentNotebook = notebooks.find((nb) => nb.id === activeNotebookId);
    const notebookLabel = currentNotebook?.name?.trim() || "this notebook";
    const confirmed = window.confirm(`Delete ${notebookLabel}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    const currentIndex = notebooks.findIndex((nb) => nb.id === activeNotebookId);
    const remaining = notebooks.filter((nb) => nb.id !== activeNotebookId);
    const nextNotebook =
      remaining.length > 0
        ? remaining[Math.min(currentIndex > 0 ? currentIndex - 1 : 0, remaining.length - 1)]
        : null;

    window.localStorage.removeItem(`${NOTEBOOK_CELLS_STORAGE_PREFIX}${activeNotebookId}`);
    setNotebooks(remaining);
    setActiveNotebookId(nextNotebook?.id ?? "");
    if (!nextNotebook) {
      setCells([]);
    }
  };

  const activeNotebook = notebooks.find((nb) => nb.id === activeNotebookId) ?? notebooks[0];

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
          <div className="notebook-controls">
            <select
              className="notebook-select"
              value={activeNotebookId}
              onChange={(event) => {
                setActiveNotebookId(event.target.value);
              }}
              disabled={anyCellRunning || notebooks.length === 0}
              aria-label="Select notebook"
            >
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.name}
                </option>
              ))}
            </select>
            <button onClick={createNotebookAndSwitch} disabled={anyCellRunning}>
              New Notebook
            </button>
          </div>

          <div className="session-controls">
            <button onClick={() => void handleDisconnect()}>Disconnect</button>
          </div>
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
        <SchemaBrowser
          schema={schema}
          loading={schemaLoading}
          refreshDisabled={schemaLoading || anyCellRunning}
          onRefresh={() => {
            void loadSchema();
          }}
        />
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
          {activeNotebook && (
            <div className="notebook-cells-toolbar">
              <div className="inline-name-row">
                {editingNotebookName ? (
                  <input
                    className="inline-name-input"
                    value={notebookNameDraft}
                    onChange={(event) => {
                      setNotebookNameDraft(event.target.value);
                    }}
                    onBlur={commitNotebookRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitNotebookRename();
                      }

                      if (event.key === "Escape") {
                        setEditingNotebookName(false);
                      }
                    }}
                    autoFocus
                    aria-label="Edit notebook name"
                  />
                ) : (
                  <>
                    <h3 className="inline-name-label">{activeNotebook.name.trim() || "Untitled Notebook"}</h3>
                    <button
                      className="name-edit-button"
                      onClick={startNotebookRename}
                      disabled={anyCellRunning}
                      aria-label="Edit notebook name"
                    >
                      <svg className="name-edit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm18-11.5a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75L21 5.75z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              <div className="notebook-cells-actions">
                <button onClick={openAddCellDialog} disabled={anyCellRunning}>
                  Add Cell
                </button>
                <button onClick={deleteActiveNotebook} disabled={anyCellRunning || notebooks.length === 0}>
                  Delete Notebook
                </button>
              </div>
            </div>
          )}
          <div className="workbench-cells-list">
            {cells.map((cell, index) => (
              <section
                className={`workbench-cell${cell.statusMinimized && cell.resultsMinimized ? " both-minimized" : ""}`}
                key={cell.id}
              >
                {cell.cellType === "cql" && (
                  <>
                    <CqlEditorPanel
                      cellName={cell.name.trim() || `Cell ${index + 1}`}
                      editingName={editingCellId === cell.id}
                      nameDraft={cellNameDraft}
                      renameDisabled={anyCellRunning}
                      onStartRename={() => startCellRename(cell.id, cell.name)}
                      onNameDraftChange={setCellNameDraft}
                      onCommitRename={() => commitCellRename(cell.id)}
                      onCancelRename={() => setEditingCellId(null)}
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
                      onRemove={() => removeCell(cell.id)}
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
                        {editingCellId === cell.id ? (
                          <div className="editor-title-row">
                            <span className="editor-title-prefix">Markdown -</span>
                            <input
                              className="inline-name-input editor-inline-name-input"
                              value={cellNameDraft}
                              onChange={(event) => {
                                setCellNameDraft(event.target.value);
                              }}
                              onBlur={() => commitCellRename(cell.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  commitCellRename(cell.id);
                                }

                                if (event.key === "Escape") {
                                  setEditingCellId(null);
                                }
                              }}
                              autoFocus
                              aria-label={`Edit markdown cell ${index + 1} name`}
                            />
                          </div>
                        ) : (
                          <div className="inline-name-row">
                            <h4>{`Markdown - ${cell.name.trim() || `Cell ${index + 1}`}`}</h4>
                            <button
                              className="name-edit-button"
                              onClick={() => startCellRename(cell.id, cell.name)}
                              disabled={anyCellRunning}
                              aria-label={`Edit markdown cell ${index + 1} name`}
                            >
                              <svg className="name-edit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm18-11.5a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75L21 5.75z" />
                              </svg>
                            </button>
                          </div>
                        )}
                        <div className="editor-toolbar-actions">
                          <button
                            className="primary"
                            onClick={() => {
                              updateCell(cell.id, (current) => ({
                                ...current,
                                markdownViewMode: current.markdownViewMode === "edit" ? "preview" : "edit"
                              }));
                            }}
                          >
                            {cell.markdownViewMode === "edit" ? "Preview" : "Edit"}
                          </button>
                          <button
                            className="remove-icon-button"
                            onClick={() => removeCell(cell.id)}
                            disabled={anyCellRunning}
                            aria-label="Remove cell"
                            title="Remove cell"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <circle cx="12" cy="12" r="8" />
                              <path d="M9 9l6 6M15 9l-6 6" />
                            </svg>
                          </button>
                        </div>
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

      {showAddCellDialog && (
        <div className="dialog-overlay" role="presentation" onClick={() => setShowAddCellDialog(false)}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Add cell"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h3>Add Cell</h3>
            <p>Select the type of cell to create.</p>
            <label className="radio-option">
              <input
                type="radio"
                name="new-cell-type"
                value="cql"
                checked={newCellType === "cql"}
                onChange={() => setNewCellType("cql")}
              />
              CQL
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="new-cell-type"
                value="markdown"
                checked={newCellType === "markdown"}
                onChange={() => setNewCellType("markdown")}
              />
              Markdown
            </label>
            <div className="dialog-actions">
              <button onClick={() => setShowAddCellDialog(false)}>Cancel</button>
              <button className="primary" onClick={confirmAddCell}>
                Add
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
