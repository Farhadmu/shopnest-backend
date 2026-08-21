import { env } from "../../../config/env";
import { ApiError } from "../../../utils/api-error";
import { logger } from "../../../utils/logger";

export interface ChatMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "url"; url: string } }
      >;
}

interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Thin wrapper around the Anthropic Messages API. Kept isolated in
 * providers/ so a different model/vendor can be swapped in without
 * touching controllers.
 */
export async function complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
  if (!env.IS_AI_ENABLED) {
    throw ApiError.internal("AI features are not configured (missing ANTHROPIC_API_KEY)");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    logger.error("Anthropic API error", { status: response.status, body: errBody });
    throw ApiError.internal("AI provider request failed");
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

  return text.trim();
}

/** Asks the model to return ONLY JSON and parses it, with a clear error on malformed output. */
export async function completeJSON<T>(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<T> {
  const raw = await complete(messages, {
    ...opts,
    system: `${opts.system ?? ""}\n\nRespond with ONLY valid JSON. No markdown fences, no preamble, no commentary.`,
  });
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error("Failed to parse AI JSON response", { raw });
    throw ApiError.internal("AI returned an unexpected response format");
  }
}
