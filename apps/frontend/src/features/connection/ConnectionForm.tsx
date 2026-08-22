import type { ChangeEvent, FormEvent } from "react";
import type { ConnectionFormState } from "./connectionTypes";

interface ConnectionFormProps {
  value: ConnectionFormState;
  testing: boolean;
  connecting: boolean;
  onChange: (next: ConnectionFormState) => void;
  onTest: () => Promise<void>;
  onConnect: () => Promise<void>;
}

export function ConnectionForm(props: ConnectionFormProps) {
  const { value, testing, connecting, onChange, onTest, onConnect } = props;

  const updateField =
    (field: keyof ConnectionFormState) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const nextValue = field === "port" ? Number.parseInt(event.target.value || "9042", 10) : event.target.value;
      onChange({ ...value, [field]: Number.isNaN(nextValue) ? 9042 : nextValue });
    };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onConnect();
  };

  return (
    <form className="connection-form" onSubmit={onSubmit}>
      <label>
        Connection Name
        <input value={value.connectionName} onChange={updateField("connectionName")} required />
      </label>

      <label>
        Contact Point(s)
        <input value={value.contactPoints} onChange={updateField("contactPoints")} placeholder="127.0.0.1,127.0.0.2" required />
      </label>

      <div className="field-row">
        <label>
          Port
          <input type="number" value={value.port} onChange={updateField("port")} min={1} max={65535} required />
        </label>

        <label>
          Local Data Center
          <input value={value.localDataCenter} onChange={updateField("localDataCenter")} required />
        </label>
      </div>

      <div className="field-row">
        <label>
          Username (optional)
          <input value={value.username} onChange={updateField("username")} autoComplete="username" />
        </label>

        <label>
          Password (optional)
          <input
            type="password"
            value={value.password}
            onChange={updateField("password")}
            autoComplete="current-password"
          />
        </label>
      </div>

      <div className="button-row">
        <button type="button" onClick={() => void onTest()} disabled={testing || connecting}>
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <button type="submit" className="primary" disabled={connecting || testing}>
          {connecting ? "Connecting..." : "Connect"}
        </button>
      </div>
    </form>
  );
}
