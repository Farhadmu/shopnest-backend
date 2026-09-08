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

export interface AiContext {
  products?: Array<{ id: string; title: string; price: number; category: string; ratingAvg: number; stock?: number }>;
  reviews?: Array<{ rating: number; comment: string }>;
  currentPrice?: number;
  stock?: number;
  sold?: number;
  categoryAvgPrice?: number;
  productName?: string;
  category?: string;
  features?: string[];
  orders?: Array<{ id: string; status: string; totalAmount: number }>;
  wishlist?: Array<{ title: string; price: number }>;
  userContext?: Record<string, unknown>;
}

export interface CompleteResult {
  content: string;
  isFallback: boolean;
}

export interface CompleteJsonResult<T> {
  data: T;
  isFallback: boolean;
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

function generateLocalFallback(messages: ChatMessage[], system?: string, context?: AiContext): string {
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
    const name = nameMatch ? nameMatch[1].trim() : (context?.productName || "Quality Product");
    const category = catMatch ? catMatch[1].trim() : (context?.category || "General");
    const features = featMatch ? featMatch[1].split(",").map((f) => f.trim()) : (context?.features || ["Premium build", "Reliable performance"]);

    const featureHighlights = features.length > 0 ? features.map((f) => `Feature: ${f}`) : ["High durability", "Verified seller warranty", "Fast delivery"];

    return JSON.stringify({
      description: `Introducing ${name}, a quality ${category} product designed for everyday use. ${features.length > 0 ? `Key features include ${features.join(", ")}.` : "Built with premium materials for lasting performance."} A great choice for customers looking for reliable value.`,
      shortDescription: `${name} in ${category}. Features: ${features.slice(0, 3).join(", ")}.`,
      seoTitle: `${name} - Best Price in BD | ShopNest`,
      seoDescription: `Buy genuine ${name} online at best price in Bangladesh on ShopNest. Fast shipping and warranty.`,
      tags: [category.toLowerCase(), ...name.toLowerCase().split(/\s+/), ...features.map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, ""))].filter(Boolean).slice(0, 8),
      highlights: featureHighlights,
    });
  }

  // Pricing prompt
  if (content.includes("Current Price:") && content.includes("Category Average Price:")) {
    const currMatch = content.match(/Current Price:\s*৳?(\d+)/i);
    const avgMatch = content.match(/Category Average Price:\s*৳?(\d+)/i);
    const curr = currMatch ? Number(currMatch[1]) : (context?.currentPrice || 1000);
    const avg = avgMatch ? Number(avgMatch[1]) : (context?.categoryAvgPrice || curr);

    const min = Math.round(Math.min(curr * 0.95, avg * 0.95));
    const max = Math.round(Math.max(curr * 1.05, avg * 1.05));
    return JSON.stringify({
      suggestedMin: min,
      suggestedMax: max,
      reason: `Based on current price of ৳${curr} and category average of ৳${avg}, pricing between ৳${min} and ৳${max} is competitive for this market segment.`,
    });
  }

  // Review summary prompt
  if (content.includes("customer reviews for a product")) {
    const reviews = context?.reviews || [];
    if (reviews.length === 0) {
      return JSON.stringify({
        overall: "Not enough data",
        positives: [],
        negatives: [],
        sentiment: { positive: 0, neutral: 100, negative: 0 },
      });
    }

    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const positiveCount = reviews.filter((r) => r.rating >= 4).length;
    const negativeCount = reviews.filter((r) => r.rating <= 2).length;
    const neutralCount = reviews.length - positiveCount - negativeCount;

    const overall = avgRating >= 3.5 ? "Mostly Positive" : avgRating >= 2.5 ? "Mixed" : "Mostly Negative";

    return JSON.stringify({
      overall,
      positives: avgRating >= 3 ? ["Customers report satisfaction with the product"] : [],
      negatives: avgRating < 3 ? ["Some customers reported issues"] : [],
      sentiment: {
        positive: Math.round((positiveCount / reviews.length) * 100),
        neutral: Math.round((neutralCount / reviews.length) * 100),
        negative: Math.round((negativeCount / reviews.length) * 100),
      },
    });
  }

  // Comparison prompt
  if (content.includes("Compare these products")) {
    const products = context?.products || [];
    if (products.length < 2) {
      return JSON.stringify({
        summary: "Not enough products to compare. Please provide at least two products.",
        winnerByValue: "",
        table: [],
      });
    }

    const table = products.map((p) => ({
      id: p.id,
      prosText: `Rated ${p.ratingAvg}/5, priced at ৳${p.price}`,
      consText: (p.stock ?? 0) <= 0 ? "Currently out of stock" : "",
    }));

    const bestValue = products.reduce((best, p) => {
      const valueScore = p.ratingAvg / Math.max(1, p.price / 1000);
      const bestScore = best.ratingAvg / Math.max(1, best.price / 1000);
      return valueScore > bestScore ? p : best;
    });

    return JSON.stringify({
      summary: `Comparing ${products.length} products. ${bestValue.title} offers the best value with a rating of ${bestValue.ratingAvg}/5 at ৳${bestValue.price}.`,
      winnerByValue: bestValue.id,
      table,
    });
  }

  // Shopping agent / general assistant response - use real context
  if (context) {
    const { orders, wishlist, userContext } = context;
    if (orders && orders.length > 0) {
      const orderSummary = orders.slice(0, 3).map((o) => `Order #${o.id.slice(-6)} (৳${o.totalAmount}, ${o.status})`).join(", ");
      return `Based on your recent activity: ${orderSummary}. You have ${orders.length} total orders. How can I help you further?`;
    }
    if (wishlist && wishlist.length > 0) {
      return `You have ${wishlist.length} items in your wishlist: ${wishlist.slice(0, 3).map((w) => `${w.title} (৳${w.price})`).join(", ")}.`;
    }
    if (userContext) {
      return "I can help you find products, compare options, and manage your orders. What are you looking for today?";
    }
  }

  // Default: honest response indicating AI is unavailable
  return "I'm currently operating in limited mode. I can help you browse products, check prices, and manage your orders. For more advanced assistance, please try again later.";
}

/**
 * AI gateway with provider fallback. Claude is preferred; text-only requests
 * automatically fall back to Gemini when Claude is unavailable, and local intelligent
 * fallback is used if no external API key is provided.
 */
export async function complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<CompleteResult> {
  if (env.ANTHROPIC_API_KEY) {
    try {
      const content = await completeWithClaude(messages, opts);
      return { content, isFallback: false };
    } catch (error) {
      logger.warn("Primary AI provider failed; attempting fallback", { provider: "anthropic", error });
    }
  }

  if (env.GEMINI_API_KEY && isTextOnly(messages)) {
    try {
      const content = await completeWithGemini(messages, opts);
      return { content, isFallback: false };
    } catch (error) {
      logger.warn("Fallback AI provider failed", { provider: "gemini", error });
    }
  }

  const content = generateLocalFallback(messages, opts.system);
  return { content, isFallback: true };
}

/**
 * Complete with context-aware fallback for cases where real data is available.
 */
export async function completeWithContext(
  messages: ChatMessage[],
  context: AiContext,
  opts: CompleteOptions = {}
): Promise<CompleteResult> {
  if (env.ANTHROPIC_API_KEY) {
    try {
      const content = await completeWithClaude(messages, opts);
      return { content, isFallback: false };
    } catch (error) {
      logger.warn("Primary AI provider failed; attempting fallback", { provider: "anthropic", error });
    }
  }

  if (env.GEMINI_API_KEY && isTextOnly(messages)) {
    try {
      const content = await completeWithGemini(messages, opts);
      return { content, isFallback: false };
    } catch (error) {
      logger.warn("Fallback AI provider failed", { provider: "gemini", error });
    }
  }

  const content = generateLocalFallback(messages, opts.system, context);
  return { content, isFallback: true };
}

export async function completeJSON<T>(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<CompleteJsonResult<T>> {
  const raw = await complete(messages, {
    ...opts,
    system: `${opts.system ?? ""}\n\nRespond with ONLY valid JSON. No markdown fences, no preamble, no commentary.`,
  });

  if (raw.isFallback) {
    try {
      const data = JSON.parse(raw.content.replace(/```json|```/g, "").trim()) as T;
      return { data, isFallback: true };
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }

  const cleaned = raw.content.replace(/```json|```/g, "").trim();
  try {
    const data = JSON.parse(cleaned) as T;
    return { data, isFallback: false };
  } catch (err) {
    logger.error("Failed to parse AI JSON response", { raw: cleaned });
    try {
      const data = JSON.parse(generateLocalFallback(messages, opts.system)) as T;
      return { data, isFallback: true };
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }
}

/**
 * CompleteJSON with context-aware fallback for cases where real data is available.
 */
export async function completeJSONWithContext<T>(
  messages: ChatMessage[],
  context: AiContext,
  opts: CompleteOptions = {}
): Promise<CompleteJsonResult<T>> {
  const raw = await completeWithContext(messages, context, {
    ...opts,
    system: `${opts.system ?? ""}\n\nRespond with ONLY valid JSON. No markdown fences, no preamble, no commentary.`,
  });

  const cleaned = raw.content.replace(/```json|```/g, "").trim();
  try {
    const data = JSON.parse(cleaned) as T;
    return { data, isFallback: raw.isFallback };
  } catch (err) {
    logger.error("Failed to parse AI JSON response", { raw: cleaned });
    try {
      const data = JSON.parse(generateLocalFallback(messages, opts.system, context)) as T;
      return { data, isFallback: true };
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }
}
