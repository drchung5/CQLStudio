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
