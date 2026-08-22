import type { SchemaResponse } from "@cqlstudio/shared";
import { apiGet } from "./client";

export function getSchema(sessionId: string): Promise<SchemaResponse> {
  const encodedSessionId = encodeURIComponent(sessionId);
  return apiGet<SchemaResponse>(`/api/schema?sessionId=${encodedSessionId}`);
}
