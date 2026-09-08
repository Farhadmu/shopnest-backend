import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/** General purpose limiter for all /api/v1 routes. */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.NODE_ENV === "development" ? Math.max(env.RATE_LIMIT_MAX, 1000) : env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again shortly." },
});

/** Tighter limiter for AI endpoints, which are expensive to call. */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many AI requests, please slow down." },
});
