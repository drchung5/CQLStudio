import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.routes.js";
import { createConnectionRouter } from "./routes/connection.routes.js";
import { createQueryRouter } from "./routes/query.routes.js";
import { createSchemaRouter } from "./routes/schema.routes.js";
import { ConnectionSessionStore } from "./services/session/ConnectionSessionStore.js";
import { CassandraService } from "./services/cassandra/CassandraService.js";

const app = express();
const sessionStore = new ConnectionSessionStore();
const cassandraService = new CassandraService();

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

app.use("/api", healthRouter);
app.use("/api/connection", createConnectionRouter(cassandraService, sessionStore));
app.use("/api/query", createQueryRouter(cassandraService, sessionStore));
app.use("/api/schema", createSchemaRouter(cassandraService, sessionStore));

app.use(errorHandler);

export { app, sessionStore };
