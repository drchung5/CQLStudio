import type { NextFunction, Request, Response } from "express";
import type { ApiResponse, QueryExecutionResult } from "@cqlstudio/shared";
import { queryExecuteSchema } from "../domain/query/QueryTypes.js";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";

interface QueryControllerDeps {
  cassandraService: CassandraService;
  sessionStore: ConnectionSessionStore;
}

export function createQueryController(deps: QueryControllerDeps) {
  return {
    execute: async (req: Request, res: Response<ApiResponse<QueryExecutionResult>>, next: NextFunction) => {
      try {
        const { sessionId, cql } = queryExecuteSchema.parse(req.body as { sessionId: string; cql: string });
        const session = deps.sessionStore.getSessionOrThrow(sessionId);
        const execution = await deps.cassandraService.executeScript(session.client, cql, session.activeKeyspace);
        session.activeKeyspace = execution.activeKeyspace;

        return res.json({ success: true, data: execution.result });
      } catch (error) {
        return next(error);
      }
    }
  };
}
