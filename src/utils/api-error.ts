/**
 * Application-level HTTP error. Thrown from controllers/services and
 * caught centrally by error.middleware.ts.
 */
export class ApiError extends Error {
  public statusCode: number;
  public details?: unknown;
  public isOperational: boolean;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message);
  }
  static forbidden(message = "Forbidden") {
    return new ApiError(403, message);
  }
  static notFound(message = "Resource not found") {
    return new ApiError(404, message);
  }
  static conflict(message = "Conflict") {
    return new ApiError(409, message);
  }
  static tooMany(message = "Too many requests") {
    return new ApiError(429, message);
  }
  static internal(message = "Internal server error", details?: unknown) {
    return new ApiError(500, message, details);
  }
}
