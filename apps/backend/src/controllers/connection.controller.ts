import type { NextFunction, Request, Response } from "express";
import type { ApiResponse, ConnectResponse, ConnectionRequest, TestConnectionResponse } from "@cqlstudio/shared";
import { connectionRequestSchema, disconnectRequestSchema } from "../domain/connection/ConnectionValidators.js";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";

interface ConnectionControllerDeps {
  cassandraService: CassandraService;
  sessionStore: ConnectionSessionStore;
}

export function createConnectionController(deps: ConnectionControllerDeps) {
  return {
    testConnection: async (
      req: Request,
      res: Response<ApiResponse<TestConnectionResponse>>,
      next: NextFunction
    ) => {
      try {
        const parsed = connectionRequestSchema.parse(req.body as ConnectionRequest);
        const response = await deps.cassandraService.testConnection(parsed);
        return res.json({ success: true, data: response });
      } catch (error) {
        return next(error);
      }
    },

    connect: async (req: Request, res: Response<ApiResponse<ConnectResponse>>, next: NextFunction) => {
      try {
        const parsed = connectionRequestSchema.parse(req.body as ConnectionRequest);
        const client = await deps.cassandraService.createConnection(parsed);
        const session = deps.sessionStore.createSession(parsed.connectionName, client);

        return res.json({
          success: true,
          data: {
            sessionId: session.id,
            connectionName: session.name
          }
        });
      } catch (error) {
        return next(error);
      }
    },

    disconnect: async (
      req: Request,
      res: Response<ApiResponse<{ disconnected: boolean }>>,
      next: NextFunction
    ) => {
      try {
        const { sessionId } = disconnectRequestSchema.parse(req.body as { sessionId: string });
        const disconnected = await deps.sessionStore.closeSession(sessionId);

        return res.json({
          success: true,
          data: {
            disconnected
          }
        });
      } catch (error) {
        return next(error);
      }
    }
  };
}
