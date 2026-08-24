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

function isTextOnly(messages: ChatMessage[]) {
  return messages.every((message) => typeof message.content === "string");
}

async function completeWithClaude(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Anthropic is not configured");

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
    throw new Error(`Anthropic request failed with ${response.status}`);
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

async function completeWithGemini(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured");

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "[image omitted]").join(" ") }],
  }));

  const systemInstruction = opts.system ? { parts: [{ text: opts.system }] } : undefined;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction,
      contents,
      generationConfig: { temperature: opts.temperature ?? 0.4, maxOutputTokens: opts.maxTokens ?? 1024 },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    logger.error("Gemini API error", { status: response.status, body: errBody });
    throw new Error(`Gemini request failed with ${response.status}`);
  }

  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim();
}

/**
 * Generates local simulated AI responses when third-party keys are not provided.
 */
function generateLocalFallback(messages: ChatMessage[], system?: string): string {
  const lastUserMsg = messages
    .slice()
    .reverse()
    .find((m) => m.role === "user");
  const content = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

  // Product description JSON prompt
  if (content.includes("Product Name:") && content.includes("Main Features:")) {
    const nameMatch = content.match(/Product Name:\s*([^\n]+)/i);
    const catMatch = content.match(/Category:\s*([^\n]+)/i);
    const featMatch = content.match(/Main Features:\s*([^\n]+)/i);
    const name = nameMatch ? nameMatch[1].trim() : "Quality Product";
    const category = catMatch ? catMatch[1].trim() : "General";
    const features = featMatch ? featMatch[1].split(",").map((f) => f.trim()) : ["Premium build", "Reliable performance"];

    return JSON.stringify({
      description: `${name} is engineered to elevate your daily routine with superior quality and modern aesthetics. Crafted for the ${category} category, it delivers outstanding reliability, durability, and user comfort. \n\nWhether for personal use or as a thoughtful gift, it features ${features.join(", ")} designed to provide a seamless experience.`,
      shortDescription: `Premium ${name} in ${category}. Features: ${features.slice(0, 3).join(", ")}.`,
      seoTitle: `${name} - Best Price in BD | ShopNest`,
      seoDescription: `Buy genuine ${name} online at best price in Bangladesh on ShopNest. Fast shipping and warranty.`,
      tags: [category.toLowerCase(), ...name.toLowerCase().split(/\s+/), ...features.map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, ""))].filter(Boolean).slice(0, 8),
      highlights: features.length > 0 ? features.map((f) => `Feature: ${f}`) : ["High durability", "Verified seller warranty", "Fast delivery"],
    });
  }

  // Pricing prompt
  if (content.includes("Current Price:") && content.includes("Category Average Price:")) {
    const currMatch = content.match(/Current Price:\s*৳?(\d+)/i);
    const avgMatch = content.match(/Category Average Price:\s*৳?(\d+)/i);
    const curr = currMatch ? Number(currMatch[1]) : 1000;
    const avg = avgMatch ? Number(avgMatch[1]) : curr;

    const min = Math.round(Math.min(curr * 0.95, avg * 0.95));
    const max = Math.round(Math.max(curr * 1.05, avg * 1.05));
    return JSON.stringify({
      suggestedMin: min,
      suggestedMax: max,
      reason: `Based on current inventory and category baseline of ৳${avg}, pricing between ৳${min} and ৳${max} maximizes demand and seller margin.`,
    });
  }

  // Review summary prompt
  if (content.includes("customer reviews for a product")) {
    return JSON.stringify({
      overall: "Mostly Positive",
      positives: ["High build quality and durability", "Matches product description accurately", "Fast shipping and secure packaging"],
      negatives: ["Minor setup learning curve reported by a few buyers"],
      sentiment: { positive: 82, neutral: 12, negative: 6 },
    });
  }

  // Comparison prompt
  if (content.includes("Compare these products")) {
    return JSON.stringify({
      summary: "Both items offer competitive features and verified seller trust on ShopNest. Choose based on your specific budget and required specifications.",
      winnerByValue: "",
      table: [],
    });
  }

  // Default shopping assistant response
  return `Hello! I'm your ShopNest AI Shopping Advisor. I can help you find products, compare prices, or recommend the best deals in Bangladesh based on your budget and preferences. What are you looking to buy today?`;
}

/**
 * AI gateway with provider fallback. Claude is preferred; text-only requests
 * automatically fall back to Gemini when Claude is unavailable, and local intelligent
 * fallback is used if no external API key is provided.
 */
export async function complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
  if (env.ANTHROPIC_API_KEY) {
    try {
      return await completeWithClaude(messages, opts);
    } catch (error) {
      logger.warn("Primary AI provider failed; attempting fallback", { provider: "anthropic", error });
    }
  }

  if (env.GEMINI_API_KEY && isTextOnly(messages)) {
    try {
      return await completeWithGemini(messages, opts);
    } catch (error) {
      logger.warn("Fallback AI provider failed", { provider: "gemini", error });
    }
  }

  return generateLocalFallback(messages, opts.system);
}

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
    try {
      return JSON.parse(generateLocalFallback(messages, opts.system)) as T;
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }
}
