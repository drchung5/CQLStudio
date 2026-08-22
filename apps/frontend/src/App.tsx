import { useState } from "react";
import { ConnectionScreen } from "./features/connection/ConnectionScreen";
import { WorkbenchPage } from "./features/workbench/WorkbenchPage";

interface ActiveSession {
  sessionId: string;
  connectionName: string;
}

export default function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);

  if (!session) {
    return (
      <ConnectionScreen
        onConnected={(sessionId, connectionName) => {
          setSession({ sessionId, connectionName });
        }}
      />
    );
  }

  return (
    <WorkbenchPage
      sessionId={session.sessionId}
      connectionName={session.connectionName}
      onDisconnect={() => {
        setSession(null);
      }}
    />
  );
}
