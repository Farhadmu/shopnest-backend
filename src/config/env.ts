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
  DB_NAME: z.string().default("shopnest"),

  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_COOKIE_NAME: z.string().default("better-auth.session_token"),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  // Primary AI Provider — Gemini
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // Fallback 1 — Groq
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

  // Fallback 2 — OpenRouter
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().default("meta-llama/llama-3.3-70b-instruct:free"),
  OPENROUTER_API_URL: z.string().default("https://openrouter.ai/api/v1"),

  // Fallback 3 — Mistral
  MISTRAL_API_KEY: z.string().optional().default(""),
  MISTRAL_MODEL: z.string().default("mistral-small-latest"),
  MISTRAL_API_URL: z.string().default("https://api.mistral.ai/v1"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),

  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(5),

  SEARCH_API_KEY: z.string().optional().default("").describe("API key for web search provider (SerpAPI, Google Custom Search, Bing, etc.)"),
  SEARCH_API_URL: z.string().optional().default("").describe("Base URL for web search provider (e.g. https://serpapi.com, https://www.googleapis.com/customsearch/v1)"),

  IMAGE_GENERATION_API_KEY: z.string().optional().default("").describe("API key for AI image generation provider (OpenAI DALL-E, Stability AI, etc.)"),
  IMAGE_GENERATION_API_URL: z.string().optional().default("").describe("Base URL for AI image generation provider (e.g. https://api.openai.com/v1)"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const aiKeysPresent =
  parsed.data.GEMINI_API_KEY.length > 0 ||
  parsed.data.GROQ_API_KEY.length > 0 ||
  parsed.data.OPENROUTER_API_KEY.length > 0 ||
  parsed.data.MISTRAL_API_KEY.length > 0;

if (!aiKeysPresent && parsed.data.NODE_ENV === "production") {
  console.warn("⚠️  WARNING: No AI API key configured (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or MISTRAL_API_KEY).");
  // eslint-disable-next-line no-console
  console.warn("⚠️  All AI features will use rule-based fallback responses.");
  // eslint-disable-next-line no-console
  console.warn("⚠️  Set at least one AI key in production for live AI responses.");
}

// Safe startup diagnostics for AI providers (no secrets exposed)
// eslint-disable-next-line no-console
console.log(`[AI] Gemini configured: ${parsed.data.GEMINI_API_KEY ? "YES" : "NO"} | model: ${parsed.data.GEMINI_MODEL || "not set"}`);
// eslint-disable-next-line no-console
console.log(`[AI] Groq configured: ${parsed.data.GROQ_API_KEY ? "YES" : "NO"} | model: ${parsed.data.GROQ_MODEL || "not set"}`);
// eslint-disable-next-line no-console
console.log(`[AI] OpenRouter configured: ${parsed.data.OPENROUTER_API_KEY ? "YES" : "NO"} | model: ${parsed.data.OPENROUTER_MODEL || "not set"}`);
// eslint-disable-next-line no-console
console.log(`[AI] Mistral configured: ${parsed.data.MISTRAL_API_KEY ? "YES" : "NO"} | model: ${parsed.data.MISTRAL_MODEL || "not set"}`);

export const env = {
  ...parsed.data,
  CORS_ORIGIN_LIST: parsed.data.CORS_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
  IS_PROD: parsed.data.NODE_ENV === "production",
  IS_AI_ENABLED: aiKeysPresent,
};