import type { QueryResult, SchemaResponse } from "@cqlstudio/shared";

export interface ExecutionState {
  status: "idle" | "running" | "success" | "error";
  message: string;
  timeMs?: number;
}

export interface WorkbenchState {
  cql: string;
  schema: SchemaResponse | null;
  result: QueryResult | null;
  execution: ExecutionState;
}

export interface WorkbenchCellState {
  id: string;
  name: string;
  cql: string;
  result: QueryResult | null;
  execution: ExecutionState;
  editorHeightPx: number;
  statusMinimized: boolean;
  resultsMinimized: boolean;
}
