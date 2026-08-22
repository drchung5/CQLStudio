import { app, sessionStore } from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.info(`CQLStudio backend listening on port ${env.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}. Closing Cassandra sessions and HTTP server.`);
  await sessionStore.closeAll();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
