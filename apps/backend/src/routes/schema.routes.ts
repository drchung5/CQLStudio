import { Router } from "express";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";
import { createSchemaController } from "../controllers/schema.controller.js";

export function createSchemaRouter(cassandraService: CassandraService, sessionStore: ConnectionSessionStore): Router {
  const router = Router();
  const controller = createSchemaController({ cassandraService, sessionStore });

  router.get("/", controller.getSchema);

  return router;
}
