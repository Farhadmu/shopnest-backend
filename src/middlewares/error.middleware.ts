import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";
import { env } from "../config/env";

/** Centralized error handler. Must be registered LAST, after all routes. */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  let statusCode = 500;
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation failed";
    details = err.flatten();
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = "Validation failed";
    details = err.errors;
  } else if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000) {
    statusCode = 409;
    message = "Duplicate value violates a unique constraint";
    details = (err as { keyValue?: unknown }).keyValue;
  } else if (err instanceof Error) {
    message = env.IS_PROD ? message : err.message;
  }

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${statusCode}`, err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(env.IS_PROD ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });
}
