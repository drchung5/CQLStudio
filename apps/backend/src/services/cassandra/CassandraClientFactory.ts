import cassandra from "cassandra-driver";
import type { ConnectionRequest } from "@cqlstudio/shared";

const { Client, auth } = cassandra;

export function createCassandraClient(connection: ConnectionRequest): cassandra.Client {
  const trimmedUsername = connection.username?.trim();
  const trimmedPassword = connection.password?.trim();

  const authProvider =
    trimmedUsername && trimmedPassword
      ? new auth.PlainTextAuthProvider(trimmedUsername, trimmedPassword)
      : undefined;

  return new Client({
    contactPoints: connection.contactPoints,
    localDataCenter: connection.localDataCenter,
    protocolOptions: {
      port: connection.port
    },
    authProvider
  });
}
