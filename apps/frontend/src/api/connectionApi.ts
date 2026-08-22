import type { ConnectResponse, ConnectionRequest, TestConnectionResponse } from "@cqlstudio/shared";
import { apiPost } from "./client";

export function testConnection(request: ConnectionRequest): Promise<TestConnectionResponse> {
  return apiPost<TestConnectionResponse>("/api/connection/test", request);
}

export function connect(request: ConnectionRequest): Promise<ConnectResponse> {
  return apiPost<ConnectResponse>("/api/connection/connect", request);
}

export function disconnect(sessionId: string): Promise<{ disconnected: boolean }> {
  return apiPost<{ disconnected: boolean }>("/api/connection/disconnect", { sessionId });
}
