import type { ExecutionState } from "../types/workbenchTypes";

interface ExecutionStatusBarProps {
  execution: ExecutionState;
}

export function ExecutionStatusBar({ execution }: ExecutionStatusBarProps) {
  return (
    <div className={`execution-status ${execution.status}`}>
      <span>{execution.message}</span>
      {typeof execution.timeMs === "number" && <span>{execution.timeMs} ms</span>}
    </div>
  );
}
