import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { AuthUser } from "./auth.middleware";

/** Restricts a route to one or more roles. Must run after requireAuth. */
export function requireRole(...roles: (AuthUser["role"] | "user")[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized("Authentication required"));
    if (req.user.banned) {
      return next(ApiError.forbidden("Your account has been suspended. Access to data is blocked. Please contact support."));
    }
    const userRole = req.user.role;
    const normalizedRole = (userRole as string) === "user" ? "customer" : userRole;
    if (!roles.includes(userRole) && !roles.includes(normalizedRole as any)) {
      return next(ApiError.forbidden(`Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}