import crypto from "crypto";
import mongoose from "mongoose";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { logger } from "../utils/logger";

/**
 * ------------------------------------------------------------------------
 * Cross-service auth with better-auth
 * ------------------------------------------------------------------------
 * The Next.js frontend owns identity via `better-auth` (mongo adapter),
 * NOT this Express backend. The frontend forwards the browser's `cookie`
 * header on every request it makes to us (see src/lib/core/session.ts ->
 * getAuthHeaders(), used by protectedFetch/protectedMutation).
 *
 * So instead of re-implementing auth, we treat better-auth's own MongoDB
 * collections ("session", "user") as the source of truth and read the
 * SAME database (MONGODB_URI must match the frontend's).
 *
 * better-auth signs its session cookie as `${token}.${base64Signature}`
 * where signature = HMAC-SHA256(token, BETTER_AUTH_SECRET). We verify that
 * signature here, then look the token up in the `session` collection.
 *
 * Gotcha: if the frontend's better-auth instance is not configured with
 * an `role` additional field on the user model, `role` will be missing and
 * we default to "customer". Add this to the frontend's auth.ts to unlock
 * seller/admin routes end-to-end:
 *
 *   betterAuth({
 *     ...
 *     user: {
 *       additionalFields: {
 *         role: { type: "string", defaultValue: "customer", input: true },
 *       },
 *     },
 *   })
 * ------------------------------------------------------------------------
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "customer" | "seller" | "admin";
  image?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function verifySignedToken(raw: string): string | null {
  const lastDot = raw.lastIndexOf(".");
  if (lastDot === -1) {
    // Unsigned cookie fallback (some better-auth configs / dev setups).
    return raw;
  }
  const token = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  return token;
}

async function resolveUserFromSessionToken(token: string): Promise<AuthUser | null> {
  const db = mongoose.connection.db;
  if (!db) return null;

  const sessionDoc = await db.collection("session").findOne({ token });
  if (!sessionDoc) return null;

  const expiresAt = sessionDoc.expiresAt ? new Date(sessionDoc.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() < Date.now()) return null;

  const userId = sessionDoc.userId ?? sessionDoc.user_id;
  if (!userId) return null;

  let userDoc = await db.collection("user").findOne({ id: userId });
  if (!userDoc) {
    try {
      userDoc = await db.collection("user").findOne({ _id: new mongoose.Types.ObjectId(String(userId)) });
    } catch {
      userDoc = null;
    }
  }
  if (!userDoc) return null;

  return {
    id: String(userDoc.id ?? userDoc._id),
    email: userDoc.email,
    name: userDoc.name ?? userDoc.email,
    role: (userDoc.role as AuthUser["role"]) ?? "customer",
    image: userDoc.image ?? null,
  };
}

/** Extracts the raw better-auth session cookie value from the request. */
function extractCookie(req: Request): string | null {
  const fromParser = (req.cookies ?? {})[env.BETTER_AUTH_COOKIE_NAME];
  if (fromParser) return fromParser;

  // Fallback: parse manually in case cookie-parser hasn't decoded it
  // (e.g. cookie name contains a dot, which is fine, but be defensive).
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${env.BETTER_AUTH_COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

/** Attaches req.user if a valid session is present; never throws. */
export const attachUserIfPresent = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    // Local/dev convenience: lets the team hit the API from Postman without
    // a live browser session. Disabled in production.
    if (!env.IS_PROD && req.headers["x-debug-user-id"]) {
      req.user = {
        id: String(req.headers["x-debug-user-id"]),
        email: String(req.headers["x-debug-user-email"] ?? "debug@shopnest.local"),
        name: String(req.headers["x-debug-user-name"] ?? "Debug User"),
        role: (req.headers["x-debug-user-role"] as AuthUser["role"]) ?? "customer",
      };
      return next();
    }

    const raw = extractCookie(req);
    if (!raw) return next();

    const token = verifySignedToken(decodeURIComponent(raw));
    if (!token) return next();

    const user = await resolveUserFromSessionToken(token);
    if (user) req.user = user;
    next();
  } catch (err) {
    logger.error("attachUserIfPresent failed", err);
    next();
  }
});

/** Rejects the request with 401 unless a valid session was attached. */
export const requireAuth = [
  attachUserIfPresent,
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized("Authentication required"));
    next();
  },
];
