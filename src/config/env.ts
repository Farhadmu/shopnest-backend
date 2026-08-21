import "dotenv/config";
import { z } from "zod";

/**
 * Validates and exposes all environment variables in one typed place.
 * The app refuses to boot if a required variable is missing/invalid,
 * which avoids subtle bugs (e.g. auth silently failing) in production.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  API_PREFIX: z.string().default("/api/v1"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_COOKIE_NAME: z.string().default("better-auth.session_token"),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),

  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  CORS_ORIGIN_LIST: parsed.data.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  IS_PROD: parsed.data.NODE_ENV === "production",
  IS_AI_ENABLED: parsed.data.ANTHROPIC_API_KEY.length > 0,
};
