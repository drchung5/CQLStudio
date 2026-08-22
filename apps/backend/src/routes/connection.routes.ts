import { Router } from "express";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";
import { createConnectionController } from "../controllers/connection.controller.js";

export function createConnectionRouter(cassandraService: CassandraService, sessionStore: ConnectionSessionStore): Router {
  const router = Router();
  const controller = createConnectionController({ cassandraService, sessionStore });

  router.post("/test", controller.testConnection);
  router.post("/connect", controller.connect);
  router.post("/disconnect", controller.disconnect);

  return router;
}
