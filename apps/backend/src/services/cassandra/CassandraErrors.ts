export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryable = false
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function mapCassandraError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (!isObject(error)) {
    return new AppError(500, "UNKNOWN_ERROR", "Unexpected error occurred", undefined, false);
  }

  const name = typeof error.name === "string" ? error.name : "UnknownError";
  const message = typeof error.message === "string" ? error.message : "Unexpected error occurred";

  if (name === "NoHostAvailableError") {
    return new AppError(400, "NO_HOST_AVAILABLE", message, undefined, true);
  }

  if (name === "OperationTimedOutError") {
    return new AppError(504, "OPERATION_TIMEOUT", message, undefined, true);
  }

  if (name === "ResponseError") {
    const details = isObject(error.info)
      ? {
          code: error.info.code,
          consistency: error.info.consistency,
          received: error.info.received,
          blockFor: error.info.blockFor
        }
      : undefined;

    return new AppError(400, "CQL_RESPONSE_ERROR", message, details, false);
  }

  if (name === "AuthenticationError") {
    return new AppError(401, "AUTHENTICATION_ERROR", "Authentication failed", undefined, false);
  }

  return new AppError(500, "CASSANDRA_ERROR", message, undefined, false);
}
