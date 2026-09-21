import { Request } from "express";
import { ApiError } from "./api-error";

/**
 * Resolves the current user's id from the request, falling back to a
 * placeholder when unauthenticated. Centralizes the "req.user?.id || ..."
 * pattern previously repeated (with inconsistent fallback strings) across
 * almost every controller.
 */
export function getUserId(req: Request, fallback: string = "anonymous-guest"): string {
  if (req.user?.banned) {
    throw ApiError.forbidden("Your account has been suspended. Access to data is blocked.");
  }
  return req.user?.id || fallback;
}
