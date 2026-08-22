import type { Request, Response } from "express";
import type { ApiResponse, SchemaResponse } from "@cqlstudio/shared";
import { sessionIdQuerySchema } from "../domain/connection/ConnectionValidators.js";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";

interface SchemaControllerDeps {
  cassandraService: CassandraService;
  sessionStore: ConnectionSessionStore;
}

export function createSchemaController(deps: SchemaControllerDeps) {
  return {
    getSchema: async (req: Request, res: Response<ApiResponse<SchemaResponse>>) => {
      const { sessionId } = sessionIdQuerySchema.parse(req.query as { sessionId: string });
      const session = deps.sessionStore.getSessionOrThrow(sessionId);
      const schema = await deps.cassandraService.getSchema(session.client);

      return res.json({ success: true, data: schema });
    }
  };
}
