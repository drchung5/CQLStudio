import { Router } from "express";
import type { CassandraService } from "../services/cassandra/CassandraService.js";
import type { ConnectionSessionStore } from "../services/session/ConnectionSessionStore.js";
import { createQueryController } from "../controllers/query.controller.js";

export function createQueryRouter(cassandraService: CassandraService, sessionStore: ConnectionSessionStore): Router {
  const router = Router();
  const controller = createQueryController({ cassandraService, sessionStore });

  router.post("/execute", controller.execute);

  return router;
}
