import { useEffect, useRef, useState } from "react";
import type { QueryExecutionResult, SchemaResponse } from "@cqlstudio/shared";
import { getSchema } from "../../api/schemaApi";
import { executeQuery } from "../../api/queryApi";
import { ApiClientError } from "../../api/client";
import { disconnect } from "../../api/connectionApi";
import { CqlEditorPanel } from "./components/CqlEditorPanel";
import { ExecutionStatusBar } from "./components/ExecutionStatusBar";
import { QueryResultsPanel } from "./components/QueryResultsPanel";
import { SchemaBrowser } from "./components/SchemaBrowser";
import type { ExecutionState } from "./types/workbenchTypes";

interface WorkbenchPageProps {
  sessionId: string;
  connectionName: string;
  onDisconnect: () => void;
}

const initialCql = "SELECT now() FROM system.local;";

type ResizeMode = "schema" | "editor" | null;

const MIN_SCHEMA_WIDTH = 220;
const MAX_SCHEMA_WIDTH = 520;
const MIN_EDITOR_HEIGHT = 200;
const MAX_EDITOR_HEIGHT = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function WorkbenchPage({ sessionId, connectionName, onDisconnect }: WorkbenchPageProps) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [cql, setCql] = useState(initialCql);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [activeKeyspace, setActiveKeyspace] = useState<string | null>(null);
  const [schemaWidthPx, setSchemaWidthPx] = useState(280);
  const [editorHeightPx, setEditorHeightPx] = useState(320);
  const [execution, setExecution] = useState<ExecutionState>({
    status: "idle",
    message: "Ready."
  });
  const [resizeMode, setResizeMode] = useState<ResizeMode>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  const loadSchema = async () => {
    try {
      setSchemaLoading(true);
      const nextSchema = await getSchema(sessionId);
      setSchema(nextSchema);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Failed to load schema.";
      setExecution({ status: "error", message });
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
          setExecution({ status: "error", message });
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
      if (resizeMode === "schema") {
        const gridRect = gridRef.current?.getBoundingClientRect();
        if (!gridRect) {
          return;
        }

        const nextWidth = clamp(event.clientX - gridRect.left, MIN_SCHEMA_WIDTH, MAX_SCHEMA_WIDTH);
        setSchemaWidthPx(nextWidth);
      }

      if (resizeMode === "editor") {
        const mainRect = mainRef.current?.getBoundingClientRect();
        if (!mainRect) {
          return;
        }

        const rawHeight = event.clientY - mainRect.top - 8;
        const maxByContainer = Math.max(MIN_EDITOR_HEIGHT, mainRect.height - 170);
        const nextHeight = clamp(rawHeight, MIN_EDITOR_HEIGHT, Math.min(MAX_EDITOR_HEIGHT, maxByContainer));
        setEditorHeightPx(nextHeight);
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

  const runQuery = async () => {
    if (!cql.trim()) {
      setExecution({ status: "error", message: "Please enter a CQL statement." });
      return;
    }

    try {
      setExecution({ status: "running", message: "Executing statement..." });
      const nextResult = await executeQuery(sessionId, cql);
      setResult(nextResult);
      setActiveKeyspace(nextResult.activeKeyspace ?? null);
      setExecution({
        status: "success",
        message:
          nextResult.statementType === "SCRIPT"
            ? `Executed ${nextResult.statementCount} statements.`
            : nextResult.statementType === "SELECT"
              ? "SELECT completed."
              : "Statement completed.",
        timeMs: nextResult.executionTimeMs
      });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Execution failed.";
      setExecution({ status: "error", message });
    }
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
          <button onClick={() => void loadSchema()} disabled={schemaLoading || execution.status === "running"}>
            {schemaLoading ? "Refreshing..." : "Refresh Schema"}
          </button>
          <button onClick={() => void handleDisconnect()}>Disconnect</button>
        </div>
      </header>

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
            setResizeMode("schema");
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize schema pane"
        />
        <main className="workbench-main" ref={mainRef}>
          <CqlEditorPanel
            value={cql}
            onChange={setCql}
            running={execution.status === "running"}
            onRun={() => void runQuery()}
            heightPx={editorHeightPx}
            activeKeyspace={activeKeyspace}
            schema={schema}
          />
          <div
            className="splitter splitter-horizontal"
            onMouseDown={() => {
              setResizeMode("editor");
            }}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and results"
          />
          <ExecutionStatusBar execution={execution} />
          <QueryResultsPanel result={result} />
        </main>
      </div>
    </section>
  );
}
