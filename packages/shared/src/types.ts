export interface ConnectionRequest {
  connectionName: string;
  contactPoints: string[];
  port: number;
  localDataCenter: string;
  username?: string;
  password?: string;
}

export interface TestConnectionResponse {
  ok: boolean;
  latencyMs: number;
  serverVersion?: string;
}

export interface ConnectResponse {
  sessionId: string;
  connectionName: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorShape;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface QueryExecuteRequest {
  sessionId: string;
  cql: string;
}

export type StatementType = "SELECT" | "NON_SELECT";

export interface SelectResult {
  statementType: "SELECT";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTimeMs: number;
  activeKeyspace?: string | null;
}

export interface NonSelectResult {
  statementType: "NON_SELECT";
  message: string;
  applied?: boolean;
  executionTimeMs: number;
  activeKeyspace?: string | null;
}

export type StatementQueryResult = SelectResult | NonSelectResult;

export interface ScriptStatementExecution {
  index: number;
  cql: string;
  result: StatementQueryResult;
}

export interface ScriptExecutionResult {
  statementType: "SCRIPT";
  statementCount: number;
  executionTimeMs: number;
  statements: ScriptStatementExecution[];
  activeKeyspace?: string | null;
}

export type QueryExecutionResult = StatementQueryResult | ScriptExecutionResult;

export type QueryResult = QueryExecutionResult;

export interface SchemaColumnNode {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isPartitionKey: boolean;
  isClusteringColumn: boolean;
  keyPosition: number | null;
  clusteringOrder: "ASC" | "DESC" | null;
  isStatic: boolean;
}

export interface SchemaTableNode {
  name: string;
  columns: SchemaColumnNode[];
}

export interface SchemaKeyspaceNode {
  name: string;
  tables: SchemaTableNode[];
}

export interface SchemaResponse {
  keyspaces: SchemaKeyspaceNode[];
}
