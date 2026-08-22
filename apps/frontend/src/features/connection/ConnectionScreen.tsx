import { useMemo, useState } from "react";
import type { ConnectionRequest } from "@cqlstudio/shared";
import { connect, testConnection } from "../../api/connectionApi";
import { ApiClientError } from "../../api/client";
import type { ConnectionFormState } from "./connectionTypes";
import { ConnectionForm } from "./ConnectionForm";

interface ConnectionScreenProps {
  onConnected: (sessionId: string, connectionName: string) => void;
}

const initialFormState: ConnectionFormState = {
  connectionName: "Local Cluster",
  contactPoints: "127.0.0.1",
  port: 9042,
  localDataCenter: "datacenter1",
  username: "",
  password: ""
};

function toRequest(state: ConnectionFormState): ConnectionRequest {
  return {
    connectionName: state.connectionName.trim(),
    contactPoints: state.contactPoints.split(",").map((point) => point.trim()).filter(Boolean),
    port: state.port,
    localDataCenter: state.localDataCenter.trim(),
    username: state.username.trim() || undefined,
    password: state.password || undefined
  };
}

export function ConnectionScreen(props: ConnectionScreenProps) {
  const [formState, setFormState] = useState<ConnectionFormState>(initialFormState);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const canSubmit = useMemo(() => {
    const request = toRequest(formState);
    return request.connectionName.length > 0 && request.contactPoints.length > 0 && request.localDataCenter.length > 0;
  }, [formState]);

  const handleTest = async () => {
    if (!canSubmit) {
      setIsError(true);
      setFeedback("Please fill required connection fields.");
      return;
    }

    try {
      setTesting(true);
      const result = await testConnection(toRequest(formState));
      setIsError(false);
      setFeedback(
        `Connection successful${result.serverVersion ? ` (server ${result.serverVersion})` : ""}. ${result.latencyMs}ms`
      );
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Connection test failed.";
      setIsError(true);
      setFeedback(message);
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!canSubmit) {
      setIsError(true);
      setFeedback("Please fill required connection fields.");
      return;
    }

    try {
      setConnecting(true);
      const result = await connect(toRequest(formState));
      setIsError(false);
      setFeedback("Connected successfully.");
      props.onConnected(result.sessionId, result.connectionName);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Connection failed.";
      setIsError(true);
      setFeedback(message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section className="connection-screen">
      <div className="connection-card">
        <h1>CQLStudio</h1>
        <p>Connect to Apache Cassandra, DSE, HCD, or Astra DB CQL endpoints.</p>

        <ConnectionForm
          value={formState}
          onChange={setFormState}
          testing={testing}
          connecting={connecting}
          onTest={handleTest}
          onConnect={handleConnect}
        />

        {feedback && <p className={isError ? "feedback error" : "feedback ok"}>{feedback}</p>}
      </div>
    </section>
  );
}
