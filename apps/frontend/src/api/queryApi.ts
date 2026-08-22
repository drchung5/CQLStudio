import type { QueryExecutionResult } from "@cqlstudio/shared";
import { apiPost } from "./client";

export function executeQuery(sessionId: string, cql: string): Promise<QueryExecutionResult> {
  return apiPost<QueryExecutionResult>("/api/query/execute", { sessionId, cql });
}
