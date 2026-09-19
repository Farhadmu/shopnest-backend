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
  provider?: string;
}

export interface CompleteJsonResult<T> {
  data: T;
  isFallback: boolean;
  provider?: string;
}

interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  role?: "customer" | "seller" | "admin";
  /** When false, skip the rule-based fallback and throw the real provider error. */
  allowFallback?: boolean;
}

export type AiFailureCode =
  | "not_configured"
  | "authentication"
  | "model"
  | "provider_error";

/** Typed AI failure so callers can distinguish config/auth/model/provider problems. */
export class AiProviderError extends Error {
  code: AiFailureCode;
  status?: number;
  provider?: string;

  constructor(code: AiFailureCode, message: string, status?: number, provider?: string) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.provider = provider;
  }
}

/** Maps an upstream provider HTTP failure to a diagnosable failure code. */
function classifyProviderError(status: number, message: string): AiFailureCode {
  const lower = message.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key") ||
    lower.includes("api-key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("permission")
  ) {
    return "authentication";
  }
  if (
    status === 404 ||
    (lower.includes("model") &&
      (lower.includes("not found") ||
        lower.includes("not_found") ||
        lower.includes("does not exist") ||
        lower.includes("unsupported")))
  ) {
    return "model";
  }
  return "provider_error";
}

function isTextOnly(messages: ChatMessage[]) {
  return messages.every((message) => typeof message.content === "string");
}

function hasImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image")
  );
}

async function fetchImageAsBase64(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { inlineData: { mimeType: contentType, data: base64 } };
  } catch {
    return null;
  }
}

async function convertMessagesForGemini(messages: ChatMessage[]): Promise<Array<{ role: string; parts: Array<Record<string, unknown>> }>> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] });
      continue;
    }

    const parts: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      if (part.type === "text") {
        parts.push({ text: part.text });
      } else if (part.type === "image") {
        const imageData = await fetchImageAsBase64(part.source.url);
        if (imageData) {
          parts.push(imageData);
        } else {
          parts.push({ text: "[image omitted]" });
        }
      }
    }
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}

const KNOWN_VISION_MODELS = new Set([
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-5-sonnet",
  "claude-3-5-haiku",
  "claude-sonnet-4",
  "claude-sonnet-4-6",
  "claude-sonnet-4-7",
  "claude-4-opus",
  "claude-4-sonnet",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20240307",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-6-20250514",
  "claude-sonnet-4-7-20250514",
  "claude-opus-4-20251120",
  "claude-sonnet-4-20251120",
  "claude-3.5-haiku",
  "claude-3.5-sonnet",
  "claude-3-sonnet",
  "claude-3-opus",
]);

function isVisionModel(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes("claude-2") || lower.includes("claude-instant")) return false;
  if (lower.includes("claude-3") || lower.includes("claude-sonnet-4") || lower.includes("claude-4") || lower.includes("claude-opus-4")) return true;
  return KNOWN_VISION_MODELS.has(lower);
}

function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") return message;
    const textParts = message.content.filter((part) => part.type === "text");
    const text = textParts.map((part) => part.text).join(" ");
    return { ...message, content: text };
  });
}

function convertMessagesForOpenAI(
  messages: ChatMessage[],
  system?: string
): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  const result: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [];
  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push({ role: message.role, content: message.content });
      continue;
    }

    const textParts = message.content
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n");
    const imageParts = message.content.filter((part) => part.type === "image");

    if (imageParts.length === 0) {
      result.push({ role: message.role, content: textParts });
    } else {
      const parts: Array<Record<string, unknown>> = [];
      if (textParts) {
        parts.push({ type: "text", text: textParts });
      }
      for (const img of imageParts) {
        if ("source" in img && img.source?.url) {
          parts.push({
            type: "image_url",
            image_url: { url: img.source.url },
          });
        }
      }
      result.push({ role: message.role, content: parts });
    }
  }

  return result;
}

async function completeWithOpenAICompatible(
  providerName: "groq" | "openrouter" | "mistral",
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: CompleteOptions,
  extraHeaders?: Record<string, string>
): Promise<string> {
  async function send(msgs: ChatMessage[]): Promise<string> {
    const formattedMessages = convertMessagesForOpenAI(msgs, opts.system);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    });

    if (!response.ok) {
      let errorMessage = `${providerName} request failed with ${response.status}`;
      let errBody = "";
      try {
        errBody = await response.text();
        const parsed = JSON.parse(errBody) as { error?: { message?: string } | string; message?: string };
        if (typeof parsed.error === "string") {
          errorMessage = parsed.error;
        } else if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        } else if (parsed.message) {
          errorMessage = parsed.message;
        }
      } catch {
        // Non-JSON response body
      }

      logger.error(`${providerName} API error`, { status: response.status, body: errBody });

      // If provider rejects images, retry once with stripped text
      const lower = errorMessage.toLowerCase();
      if ((lower.includes("image") || lower.includes("vision") || lower.includes("multimodal")) && hasImages(msgs)) {
        const stripped = stripImages(msgs);
        logger.warn(`${providerName} rejected image content; retrying with text only`, {
          model,
          originalError: errorMessage,
        });
        return send(stripped);
      }

      throw new AiProviderError(
        classifyProviderError(response.status, errorMessage),
        errorMessage,
        response.status,
        providerName
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return content.trim();
  }

  return send(messages);
}

async function completeWithGroq(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.GROQ_API_KEY) throw new Error("Groq is not configured");
  const candidateModels = Array.from(new Set([env.GROQ_MODEL, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"])).filter(Boolean);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      return await completeWithOpenAICompatible(
        "groq",
        "https://api.groq.com/openai/v1/chat/completions",
        env.GROQ_API_KEY,
        model,
        messages,
        opts
      );
    } catch (err: any) {
      lastError = err;
      if (err instanceof AiProviderError && err.code === "model") {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Groq completion failed");
}

async function completeWithOpenRouter(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OpenRouter is not configured");
  const endpoint = `${env.OPENROUTER_API_URL.replace(/\/$/, "")}/chat/completions`;
  const cleanModel = env.OPENROUTER_MODEL.replace(/:free$/, "");
  const candidateModels = Array.from(new Set([env.OPENROUTER_MODEL, cleanModel])).filter(Boolean);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      return await completeWithOpenAICompatible(
        "openrouter",
        endpoint,
        env.OPENROUTER_API_KEY,
        model,
        messages,
        opts,
        {
          "HTTP-Referer": "https://shopnest.com",
          "X-Title": "ShopNest",
        }
      );
    } catch (err: any) {
      lastError = err;
      if (err instanceof AiProviderError && err.code === "model") {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("OpenRouter completion failed");
}

async function completeWithMistral(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.MISTRAL_API_KEY) throw new Error("Mistral is not configured");
  const endpoint = `${env.MISTRAL_API_URL.replace(/\/$/, "")}/chat/completions`;
  const candidateModels = Array.from(new Set([env.MISTRAL_MODEL, "open-mistral-7b", "mistral-tiny"])).filter(Boolean);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      return await completeWithOpenAICompatible(
        "mistral",
        endpoint,
        env.MISTRAL_API_KEY,
        model,
        messages,
        opts
      );
    } catch (err: any) {
      lastError = err;
      if (err instanceof AiProviderError && (err.code === "model" || err.status === 429)) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Mistral completion failed");
}

async function completeWithGemini(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured");

  const contents = await convertMessagesForGemini(messages);
  const systemInstruction = opts.system ? { parts: [{ text: opts.system }] } : undefined;
  const candidateModels = Array.from(new Set([env.GEMINI_MODEL, "gemini-3.6-flash", "gemini-2.5-flash"])).filter(Boolean);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: { temperature: opts.temperature ?? 0.4, maxOutputTokens: Math.max(opts.maxTokens ?? 1024, 2048) },
        }),
      });

      if (!response.ok) {
        let errorMessage = `Gemini request failed with ${response.status}`;
        let errBody = "";
        try {
          errBody = await response.text();
          const parsed = JSON.parse(errBody) as { error?: { message?: string } };
          if (parsed.error?.message) {
            errorMessage = parsed.error.message;
          }
        } catch {
          // Non-JSON error body
        }
        logger.error("Gemini API error", { status: response.status, body: errBody });
        throw new AiProviderError(classifyProviderError(response.status, errorMessage), errorMessage, response.status, "gemini");
      }

      const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n").trim();
    } catch (err: any) {
      lastError = err;
      if (err instanceof AiProviderError && err.code === "model") {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Gemini completion failed");
}

function generateLocalFallback(messages: ChatMessage[], system?: string, context?: AiContext, role: "customer" | "seller" | "admin" = "customer"): string {
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
    const name = nameMatch ? nameMatch[1].trim() : (context?.productName || "Product");
    const category = catMatch ? catMatch[1].trim() : (context?.category || "General");
    const features = featMatch ? featMatch[1].split(",").map((f) => f.trim()) : (context?.features || []);

    const featureHighlights = features.length > 0 ? features.map((f) => `Feature: ${f}`) : ["Features not specified"];

    return JSON.stringify({
      description: `${name} is a ${category} product. ${features.length > 0 ? `Key features include ${features.join(", ")}.` : "Detailed AI-generated description is currently unavailable."}`,
      shortDescription: `${name} in ${category}.${features.length > 0 ? ` Features: ${features.slice(0, 3).join(", ")}.` : ""}`,
      seoTitle: `${name} - ${category} | ShopNest`,
      seoDescription: `Buy ${name} online on ShopNest. Fast shipping and seller warranty available.`,
      tags: [category.toLowerCase(), ...name.toLowerCase().split(/\s+/), ...features.map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, ""))].filter(Boolean).slice(0, 8),
      highlights: featureHighlights,
    });
  }

  // Pricing prompt
  if (content.includes("Current Price:") && content.includes("Category Average Price:")) {
    const currMatch = content.match(/Current Price:\s*৳?(\d+)/i);
    const avgMatch = content.match(/Category Average Price:\s*৳?(\d+)/i);
    const curr = currMatch ? Number(currMatch[1]) : (context?.currentPrice || 0);
    const avg = avgMatch ? Number(avgMatch[1]) : (context?.categoryAvgPrice || curr);

    if (curr <= 0 || avg <= 0) {
      return JSON.stringify({
        suggestedMin: 0,
        suggestedMax: 0,
        reason: "Insufficient pricing data to generate a recommendation.",
      });
    }

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

  // Role-aware shopping/business assistant response - use real context
  if (context) {
    const { orders, wishlist, userContext, products } = context;

    if (role === "seller") {
      if (products && products.length > 0) {
        const productList = products.slice(0, 3).map((p) => `${p.title} (৳${p.price})`).join(", ");
        return `I found ${products.length} products in your store: ${productList}. ${products.length > 3 ? `Showing top 3 of ${products.length}.` : ""} Store analytics are temporarily unavailable, but you can manage these products from your dashboard.`;
      }
      if (orders && orders.length > 0) {
        const orderSummary = orders.slice(0, 3).map((o) => `Order #${o.id.slice(-6)} (৳${o.totalAmount}, ${o.status})`).join(", ");
        return `Based on your recent store orders: ${orderSummary}. You have ${orders.length} total orders. What would you like to analyze?`;
      }
      if (userContext) {
        return "I can help you analyze sales, manage inventory, and optimize your store performance. What would you like to know?";
      }
      return "I can help you analyze your store performance, manage products, and optimize sales. What would you like to know?";
    }

    if (role === "admin") {
      if (userContext && (userContext as any).totalRevenue) {
        const revenue = (userContext as any).totalRevenue;
        const userCount = (userContext as any).userCount;
        const orderCount = (userContext as any).orderCount;
        return `Marketplace overview: ${userCount} users, ${orderCount} orders, total revenue ৳${revenue.toLocaleString()}. Platform analytics are temporarily unavailable, but you can access the full admin dashboard.`;
      }
      if (userContext) {
        return "I can help you analyze platform health, review incidents, and manage marketplace operations. What would you like to know?";
      }
      return "I can help you analyze platform performance, review security incidents, and manage marketplace operations. What would you like to know?";
    }

    // Customer role (default)
    if (products && products.length > 0) {
      const productList = products.slice(0, 3).map((p) => `${p.title} (৳${p.price})`).join(", ");
      return `I found ${products.length} verified catalog product${products.length > 1 ? "s" : ""}: ${productList}. ${products.length > 3 ? `Showing the first 3 of ${products.length}.` : ""}`;
    }
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

  // Default: a safe, useful local response. Callers that have richer
  // conversation state can replace this with their own contextual fallback.
  if (role === "seller") {
    return "AI assistant is currently unavailable. You can still browse your products, check orders, and manage your store. Please try again later for AI-powered business insights.";
  }
  if (role === "admin") {
    return "AI assistant is currently unavailable. You can still access the admin dashboard for platform analytics. Please try again later for AI-powered insights.";
  }
  return "Hey! 👋 I can help you find verified ShopNest products, check orders, manage your cart or wishlist, and explain how the platform works. What would you like to do?";
}

/**
 * Multi-Tier AI Gateway with Fallback:
 * 1. Gemini (Primary)
 * 2. Groq (Fallback 1)
 * 3. OpenRouter (Fallback 2)
 * 4. Mistral (Fallback 3)
 *
 * Runs configured providers in order; when all providers fail and `allowFallback`
 * is false, throws a typed AiProviderError. Otherwise falls back to local rule-based responses.
 */
async function runProviders(
  messages: ChatMessage[],
  opts: CompleteOptions,
  context?: AiContext
): Promise<CompleteResult> {
  const providers = [
    { name: "gemini", fn: () => completeWithGemini(messages, opts), guard: () => Boolean(env.GEMINI_API_KEY) },
    { name: "groq", fn: () => completeWithGroq(messages, opts), guard: () => Boolean(env.GROQ_API_KEY) },
    { name: "openrouter", fn: () => completeWithOpenRouter(messages, opts), guard: () => Boolean(env.OPENROUTER_API_KEY) },
    { name: "mistral", fn: () => completeWithMistral(messages, opts), guard: () => Boolean(env.MISTRAL_API_KEY) },
  ] as const;

  let configuredCount = 0;
  let lastError: unknown = null;

  for (const provider of providers) {
    if (!provider.guard()) continue;
    configuredCount += 1;
    try {
      const content = await provider.fn();
      return { content, isFallback: false, provider: provider.name };
    } catch (error) {
      lastError = error;
      logger.warn("AI provider failed; attempting next fallback provider", {
        provider: provider.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (opts.allowFallback === false) {
    if (configuredCount === 0) {
      throw new AiProviderError(
        "not_configured",
        "No AI provider is configured on the server. Set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or MISTRAL_API_KEY."
      );
    }
    if (lastError instanceof AiProviderError) throw lastError;
    throw new AiProviderError(
      "provider_error",
      lastError instanceof Error ? lastError.message : "AI provider request failed"
    );
  }

  const content = generateLocalFallback(messages, opts.system, context, opts.role);
  return { content, isFallback: true };
}

export async function complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<CompleteResult> {
  return runProviders(messages, opts);
}

/**
 * Complete with context-aware fallback for cases where real data is available.
 */
export async function completeWithContext(
  messages: ChatMessage[],
  context: AiContext,
  opts: CompleteOptions = {}
): Promise<CompleteResult> {
  return runProviders(messages, opts, context);
}

export async function completeJSON<T>(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<CompleteJsonResult<T>> {
  const raw = await complete(messages, {
    ...opts,
    system: `${opts.system ?? ""}\n\nRespond with ONLY valid JSON. No markdown fences, no preamble, no commentary.`,
  });

  if (raw.isFallback) {
    try {
      const data = JSON.parse(raw.content.replace(/```json|```/g, "").trim()) as T;
      return { data, isFallback: true, provider: raw.provider };
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }

  const cleaned = raw.content.replace(/```json|```/g, "").trim();
  try {
    const data = JSON.parse(cleaned) as T;
    return { data, isFallback: false, provider: raw.provider };
  } catch (err) {
    logger.error("Failed to parse AI JSON response", { raw: cleaned });
    try {
      const data = JSON.parse(generateLocalFallback(messages, opts.system, undefined, opts.role)) as T;
      return { data, isFallback: true, provider: raw.provider };
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
    return { data, isFallback: raw.isFallback, provider: raw.provider };
  } catch (err) {
    logger.error("Failed to parse AI JSON response", { raw: cleaned });
    try {
      const data = JSON.parse(generateLocalFallback(messages, opts.system, context, opts.role)) as T;
      return { data, isFallback: true, provider: raw.provider };
    } catch {
      throw ApiError.internal("AI returned an unexpected response format");
    }
  }
}
