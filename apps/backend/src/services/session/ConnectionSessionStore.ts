import { randomUUID } from "node:crypto";
import type cassandra from "cassandra-driver";
import { AppError } from "../cassandra/CassandraErrors.js";

export interface ConnectionSession {
  id: string;
  name: string;
  createdAt: string;
  client: cassandra.Client;
  activeKeyspace: string | null;
}

export class ConnectionSessionStore {
  private readonly sessions = new Map<string, ConnectionSession>();

  public createSession(name: string, client: cassandra.Client): ConnectionSession {
    const id = randomUUID();
    const session: ConnectionSession = {
      id,
      name,
      createdAt: new Date().toISOString(),
      client,
      activeKeyspace: null
    };

    this.sessions.set(id, session);
    return session;
  }

  public getSessionOrThrow(sessionId: string): ConnectionSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError(404, "SESSION_NOT_FOUND", "Connection session not found");
    }

    return session;
  }

  public async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    await session.client.shutdown();
    return true;
  }

  public async closeAll(): Promise<void> {
    const closingPromises: Promise<void>[] = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      this.sessions.delete(sessionId);
      closingPromises.push(session.client.shutdown());
    }
    await Promise.allSettled(closingPromises);
  }
}
