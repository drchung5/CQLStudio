import dotenv from "dotenv";

dotenv.config();

const parsedPort = Number.parseInt(process.env.BACKEND_PORT ?? "4000", 10);

export const env = {
  port: Number.isNaN(parsedPort) ? 4000 : parsedPort,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};
