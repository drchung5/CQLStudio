import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  const started = Date.now();

  req.on("close", () => {
    const elapsedMs = Date.now() - started;
    console.info(`[API] ${req.method} ${req.originalUrl} ${elapsedMs}ms`);
  });

  next();
}
