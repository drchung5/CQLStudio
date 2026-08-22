import Editor from "@monaco-editor/react";

interface CqlEditorPanelProps {
  value: string;
  running: boolean;
  heightPx: number;
  activeKeyspace: string | null;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function CqlEditorPanel({ value, running, heightPx, activeKeyspace, onChange, onRun }: CqlEditorPanelProps) {
  return (
    <section className="editor-panel">
      <div className="editor-toolbar">
        <div className="editor-toolbar-title">
          <h3>CQL Editor</h3>
          <p className="editor-keyspace">
            Keyspace: <strong>{activeKeyspace ?? "(none)"}</strong>
          </p>
        </div>
        <button onClick={onRun} disabled={running} className="primary">
          {running ? "Running..." : "Run"}
        </button>
      </div>
      <Editor
        height={`${heightPx}px`}
        defaultLanguage="sql"
        value={value}
        onChange={(next) => onChange(next ?? "")}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            onRun();
          });
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: "on"
        }}
      />
      <p className="hint">Shortcut: Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)</p>
    </section>
  );
}
