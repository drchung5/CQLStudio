import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { ApiFailure } from "@cqlstudio/shared";
import { AppError, mapCassandraError } from "../services/cassandra/CassandraErrors.js";

export function errorHandler(error: unknown, _req: Request, res: Response<ApiFailure>, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        },
        retryable: false
      }
    });
    return;
  }

  const mapped = error instanceof AppError ? error : mapCassandraError(error);

  res.status(mapped.statusCode).json({
    success: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      details: mapped.details,
      retryable: mapped.retryable
    }
  });
}
