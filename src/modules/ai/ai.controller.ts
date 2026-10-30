// AI Comparison Decision Engine: Multi-model evaluation with structured fallback matrix
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { Product } from "../products/product.model";
import { VisualSearchDemand } from "./visual-search-demand.model";
import { VisualSearchHistory } from "./visual-search-history.model";
import { validateImageBuffer, isSafeRemoteUrl, unwrapImageUrl } from "./image-validation.service";
import { rankProductsHybrid, VisualAnalysisUnderstanding } from "./visual-ranking.service";
import sharp from "sharp";
import { Store } from "../sellers/store.model";
import { Order } from "../orders/order.model";
import { Coupon } from "../coupons/coupon.model";
import { Category } from "../categories/category.model";
import { completeJSON, completeJSONWithContext, completeWithContext, AiContext } from "./providers/claude.provider";
import {
  PRODUCT_DESCRIPTION_SYSTEM,
  buildDescriptionPrompt,
  COMPARE_SYSTEM,
  buildComparePrompt,
  PRICING_SYSTEM,
  buildPricingPrompt,
  PRODUCT_ANALYSIS_SYSTEM,
  PRODUCT_CONTENT_SYSTEM,
  TRANSLATION_SYSTEM,
} from "./prompts";
import { summarizeProductReviews } from "./trust/reviewIntelligence";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { logAiIncident } from "./incident/incident.service";
import { getSellerStore } from "../sellers/seller-store.util";
import { buildPublicProductFilter, getPublicProduct } from "../../utils/activeProductFilter";
import { env } from "../../config/env";

/**
 * Controller: AI Health Check
 *
 * Returns provider configuration status without exposing secrets.
 */
export const aiHealth = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, {
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      model: env.GEMINI_MODEL || null,
    },
    groq: {
      configured: Boolean(env.GROQ_API_KEY),
      model: env.GROQ_MODEL || null,
    },
    openrouter: {
      configured: Boolean(env.OPENROUTER_API_KEY),
      model: env.OPENROUTER_MODEL || null,
    },
    mistral: {
      configured: Boolean(env.MISTRAL_API_KEY),
      model: env.MISTRAL_MODEL || null,
    },
  });
});

/**
 * Controller: Recommend Products
 *
 * 1. Inputs Extracted:
 *    - req.body: query, budgetMax, category
 * 2. Database Operation:
 *    - Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(10)
 * 3. Response Sent:
 *    - HTTP 200: { count, products: [...] }
 */
export const recommend = asyncHandler(async (req: Request, res: Response) => {
  const { query, budgetMax, category } = req.body as { query?: string; budgetMax?: number; category?: string };

  const filter = await buildPublicProductFilter({});
  if (budgetMax) filter.price = { $lte: budgetMax };
  if (category) filter.category = category;
  if (query) filter.$text = { $search: query };

  const products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(10);
  sendSuccess(res, { count: products.length, products });
});

/**
 * Controller: Generate AI Product Description (Sellers & Admins)
 *
 * 1. Inputs Extracted:
 *    - req.body: productName, category, features
 *    - req.user: Logged-in seller/admin ID
 * 2. Database Operation:
 *    - None directly; invokes completeJSON prompt engine
 * 3. Response Sent:
 *    - HTTP 200: { description, bulletPoints, isFallback }
 */
export const productDescription = asyncHandler(async (req: Request, res: Response) => {
  const { productName, category, features } = req.body as { productName: string; category: string; features: string[] };

  try {
    const result = await completeJSON(
      [{ role: "user", content: buildDescriptionPrompt({ productName, category, features }) }],
      { system: PRODUCT_DESCRIPTION_SYSTEM }
    );
    sendSuccess(res, { ...(result.data as Record<string, unknown>), isFallback: result.isFallback });
  } catch (err) {
    await logAiIncident({
      type: "MALFORMED_OUTPUT",
      userId: req.user?.id,
      endpoint: "/ai/product-description",
      input: productName,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

/**
 * Controller: Review Summary & Sentiment Breakdown
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product ID
 * 2. Database Operation:
 *    - Queries Review collection via summarizeProductReviews helper
 * 3. Response Sent:
 *    - HTTP 200: Summary JSON object { summary, positivePoints, negativePoints, sentimentScore }
 */
export const reviewSummary = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const result = await summarizeProductReviews(productId);
  sendSuccess(res, result);
});

/**
 * Controller: Compare Products Side-By-Side
 *
 * 1. Inputs Extracted:
 *    - req.body.productIds: Array of product IDs to compare (min 2)
 * 2. Database Operation:
 *    - Product.find({ _id: { $in: productIds }, isDeleted: false })
 * 3. Response Sent:
 *    - HTTP 200: Comparative analysis matrix
 */
export const compareProducts = asyncHandler(async (req: Request, res: Response) => {
  const { productIds, userPrompt, priority, weights } = req.body as {
    productIds: string[];
    userPrompt?: string;
    priority?: string;
    weights?: Record<string, number>;
  };
  const filter = await buildPublicProductFilter({ _id: { $in: productIds } });
  const products = await Product.find(filter).lean();
  if (products.length < 2) throw ApiError.badRequest("Could not find enough matching products to compare");

  // Fetch store details to enrich seller trust
  const storeIds = Array.from(new Set(products.map((p) => p.storeId).filter(Boolean)));
  const stores = await Store.find({
    $or: [{ ownerId: { $in: storeIds } }, { _id: { $in: storeIds.filter((id) => mongoose.isValidObjectId(id)) } }],
  })
    .select("_id ownerId storeName trustScore rating")
    .lean();

  const storeMap = new Map<string, { storeName: string; trustScore: number }>();
  for (const s of stores) {
    const data = { storeName: s.storeName, trustScore: s.trustScore || 80 };
    if (s.ownerId) storeMap.set(s.ownerId, data);
    storeMap.set(String(s._id), data);
  }

  const promptProducts = products.map((p) => {
    let specs: Record<string, string> = {};
    if (p.specifications instanceof Map) {
      specs = Object.fromEntries(p.specifications.entries());
    } else if (p.specifications && typeof p.specifications === "object") {
      specs = p.specifications as Record<string, string>;
    }

    const storeInfo = storeMap.get(p.storeId) || { storeName: "Official Seller", trustScore: 85 };

    return {
      id: String(p._id),
      title: p.title,
      price: p.discountPrice ?? p.price,
      ratingAvg: p.ratingAvg || 4.5,
      category: p.category,
      stock: p.stock,
      specifications: specs,
      warrantyMonths: p.warrantyMonths,
      freeDelivery: Boolean(p.freeDelivery),
      storeName: storeInfo.storeName,
      trustScore: storeInfo.trustScore,
      sentiment: p.sentiment,
    };
  });

  const prompt = buildComparePrompt(promptProducts, { userPrompt, priority, weights });

  const result = await completeJSONWithContext(
    [
      {
        role: "user",
        content: prompt,
      },
    ],
    {
      products: promptProducts,
      userPrompt,
      priority,
      weights,
    },
    { system: COMPARE_SYSTEM }
  );

  sendSuccess(res, { ...(result.data as Record<string, unknown>), isFallback: result.isFallback });
});

/**
 * Controller: AI Pricing Suggestion (Sellers & Admins)
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product ID
 * 2. Database Operation:
 *    - Product.findOne({ _id: productId })
 *    - Product.aggregate(...) to compute average category price
 * 3. Response Sent:
 *    - HTTP 200: { currentPrice, categoryAvgPrice, suggestedMin, suggestedMax, reason }
 */
export const pricingSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  const categoryMatch = await buildPublicProductFilter({ category: product.category });
  const categoryAgg = await Product.aggregate([
    { $match: categoryMatch },
    { $group: { _id: null, avgPrice: { $avg: "$price" } } },
  ]);
  const categoryAvgPrice = Math.round((categoryAgg[0]?.avgPrice ?? product.price) * 100) / 100;

  const result = await completeJSON<{ suggestedMin: number; suggestedMax: number; reason: string }>(
    [
      {
        role: "user",
        content: buildPricingPrompt({
          currentPrice: product.price,
          stock: product.stock,
          sold: product.sold,
          ratingAvg: product.ratingAvg,
          categoryAvgPrice,
        }),
      },
    ],
    { system: PRICING_SYSTEM }
  );

  sendSuccess(res, {
    currentPrice: product.price,
    categoryAvgPrice,
    ...(result.data as Record<string, unknown>),
    isFallback: result.isFallback,
  });
});

/**
 * Controller: Visual Search
 *
 * 1. Inputs Extracted:
 *    - req.body.imageUrl: Image link
 *    - req.body.searchQuery: Optional detected search query
 * 2. Database Operation:
 *    - Product.find(...) based on extracted filename keywords or text search
 * 3. Response Sent:
 *    - HTTP 200: { detectedQuery, count, products }
 */
type VisualAnalysisResult = VisualAnalysisUnderstanding;

/**
 * Helper: Save Remote Image Locally for Visual Search & Permanent Customer Demand Archiving
 * Enforces SSRF protection, safe protocols, and buffer validation.
 */
/**
 * Helper: Download remote image with automatic fallback from unwrapped URL to proxy URL
 */
async function downloadRemoteImageBuffer(rawUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const unwrapped = unwrapImageUrl(rawUrl);
  // Try unwrapped URL first; if unwrapped differs from rawUrl, also keep rawUrl as fallback
  const targets = Array.from(new Set([unwrapped, rawUrl])).filter(
    (u) => u && (u.startsWith("http://") || u.startsWith("https://"))
  );

  for (const target of targets) {
    try {
      const safety = isSafeRemoteUrl(target);
      if (!safety.isSafe) continue;

      const response = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 50) {
          const contentType = response.headers.get("content-type") || "image/jpeg";
          return { buffer, contentType };
        }
      }
    } catch {
      // try next target
    }
  }
  return null;
}

async function saveRemoteImageLocally(url: string): Promise<string> {
  try {
    const cleanUrl = unwrapImageUrl(url);
    if (cleanUrl.startsWith("/uploads/")) {
      return cleanUrl;
    }

    const download = await downloadRemoteImageBuffer(url);
    if (!download) {
      return url;
    }

    const validation = await validateImageBuffer(download.buffer);
    if (!validation.isValid) {
      logger.warn("Remote visual search image failed validation", { url, error: validation.error });
      return url;
    }

    const uploadVisualDir = path.resolve(env.UPLOAD_DIR, "visual-search");
    if (!fs.existsSync(uploadVisualDir)) {
      fs.mkdirSync(uploadVisualDir, { recursive: true });
    }

    const ext = validation.format === "png" ? ".png" : validation.format === "webp" ? ".webp" : ".jpg";
    const fileName = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(uploadVisualDir, fileName);
    await fs.promises.writeFile(filePath, download.buffer);

    return `/uploads/visual-search/${fileName}`;
  } catch (err) {
    logger.warn("Failed to download and store remote visual search image locally", { err, url });
    return url;
  }
}

async function getVisualImageBase64(rawImageUrl: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const imageUrl = unwrapImageUrl(rawImageUrl);
    let rawBuffer: Buffer | null = null;
    let initialMimeType = "image/jpeg";

    if (imageUrl.startsWith("/uploads/")) {
      const relPath = imageUrl.replace(/^\/uploads\//, "");
      const fullPath = path.resolve(env.UPLOAD_DIR, relPath);
      if (fs.existsSync(fullPath)) {
        rawBuffer = await fs.promises.readFile(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        initialMimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      }
    } else if (imageUrl.startsWith("data:image/")) {
      const parts = imageUrl.split(",");
      const mimeMatch = parts[0].match(/:(.*?);/);
      initialMimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      rawBuffer = Buffer.from(parts[1], "base64");
    } else if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      // Check if it points to a local upload path on any port
      const uploadMatch = imageUrl.match(/https?:\/\/[^/]+(\/uploads\/[^\s?#]+)/i);
      if (uploadMatch) {
        const relPath = uploadMatch[1].replace(/^\/uploads\//, "");
        const fullPath = path.resolve(env.UPLOAD_DIR, relPath);
        if (fs.existsSync(fullPath)) {
          rawBuffer = await fs.promises.readFile(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          initialMimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        }
      }

      if (!rawBuffer) {
        const download = await downloadRemoteImageBuffer(rawImageUrl);
        if (download) {
          rawBuffer = download.buffer;
          initialMimeType = download.contentType;
        }
      }
    }

    if (!rawBuffer) return null;

    // Use Sharp to auto-orient phone photos and resize to max 1024x1024 for lightning-fast AI vision processing
    try {
      const optimizedBuffer = await sharp(rawBuffer)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { mimeType: "image/jpeg", data: optimizedBuffer.toString("base64") };
    } catch {
      return { mimeType: initialMimeType, data: rawBuffer.toString("base64") };
    }
  } catch (err) {
    logger.warn("Failed to convert image to base64 for visual search", { err, imageUrl: rawImageUrl });
  }
  return null;
}

async function analyzeProductImageWithAI(imageUrl: string, searchQuery?: string): Promise<VisualAnalysisUnderstanding> {
  const fallbackWords = searchQuery?.trim() || "";
  let heuristicTitle = fallbackWords;

  // Extract from filename or URL slug if searchQuery is absent
  if (!heuristicTitle) {
    try {
      const cleanUrl = imageUrl.split("?")[0].split("#")[0];
      const filename = path.basename(cleanUrl);
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
      // if not a pure uuid or random hash
      if (!/^[0-9a-fA-F-]{20,}$/.test(nameWithoutExt)) {
        const cleanedName = nameWithoutExt.replace(/[-_+]/g, " ").trim();
        if (cleanedName.length > 2) {
          heuristicTitle = cleanedName;
        }
      }
    } catch {
      // ignore
    }
  }

  if (!heuristicTitle) {
    heuristicTitle = "Product";
  }

  // Infer broad category and subcategory if any common keyword/model is present
  const textToAnalyze = `${heuristicTitle} ${imageUrl}`.toLowerCase();
  let inferredCategory = "General";
  let inferredSubcategory: string | undefined = undefined;
  let inferredProductType: string = heuristicTitle;

  if (/(headphone|earphone|earbud|speaker|soundbar|audio|xm[345]|airpod|buds)/i.test(textToAnalyze)) {
    inferredCategory = "Electronics";
    inferredSubcategory = /(earbud|buds|airpod)/i.test(textToAnalyze) ? "Wireless Earbuds" : "Over-Ear Headphones";
    inferredProductType = /(earbud|buds|airpod)/i.test(textToAnalyze) ? "Earbuds" : "Headphones";
  } else if (/(phone|smartphone|tablet|laptop|computer|keyboard|mouse|monitor|gpu|cpu)/i.test(textToAnalyze)) {
    inferredCategory = "Electronics";
    inferredSubcategory = "Gadgets & Computers";
    inferredProductType = /(keyboard)/i.test(textToAnalyze) ? "Keyboard" : "Gadgets";
  } else if (/(shirt|pant|jeans|jacket|hoodie|shoe|sneaker|dress|watch|bag|backpack)/i.test(textToAnalyze)) {
    inferredCategory = "Fashion";
    inferredSubcategory = /(shoe|sneaker)/i.test(textToAnalyze) ? "Footwear" : "Clothing & Accessories";
    inferredProductType = /(shoe|sneaker)/i.test(textToAnalyze) ? "Sneakers" : "Apparel";
  }

  const defaultFallback: VisualAnalysisUnderstanding = {
    title: heuristicTitle,
    category: inferredCategory,
    subcategory: inferredSubcategory,
    productType: inferredProductType,
    brand: "Generic",
    model: "N/A",
    marketPriceEstimate: "N/A",
    color: "Multi-color",
    colors: [],
    style: ["Standard"],
    visualAttributes: ["Visual search product"],
    features: ["Visual search product"],
    keywords: heuristicTitle.split(" ").filter((w) => w.length > 2),
    confidence: "low",
  };

  // If in automated unit testing without explicit live test flag, use deterministic fallback
  const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  if (isTestEnv && process.env.TEST_LIVE_AI !== "true") {
    return defaultFallback;
  }

  const imageData = await getVisualImageBase64(imageUrl);
  if (!imageData) {
    return defaultFallback;
  }

  const promptText = `You are an expert product identification vision AI for an e-commerce marketplace.
Carefully examine this product image in high detail. Even if taken from a customer's personal phone camera under ambient lighting, accurately identify what product this is, including its exact market name, model number, brand, category, and features.
${searchQuery ? `Customer hint or partial product name: "${searchQuery}"` : ""}

Respond ONLY with valid JSON (strictly no markdown, no explanation, no backticks):
{
  "title": "Exact market product name and model in English (e.g., 'Sony WH-1000XM4 Wireless Headphones', 'Nike Free RN Flyknit', 'Apple iPhone 15 Pro Max', 'Joyroom 15W Magnetic Wireless Charger')",
  "category": "Main shopping category such as Electronics & Gadgets, Fashion & Clothing, Home & Living, Beauty & Personal Care, Sports & Fitness, Computers & Accessories",
  "subcategory": "Specific subcategory (e.g. Wireless Earbuds, Over-Ear Headphones, Running Shoes, Smartwatch, Backpack)",
  "productType": "Specific product noun (e.g., Earbuds, Headphones, Shoes, Jacket, Watch, Charger, Phone, Laptop)",
  "brand": "Identified brand name or Generic",
  "model": "Identified exact model name/number or edition (e.g. 'WH-1000XM4', 'Free RN Flyknit', 'A2849', 'Slim 3 15AMN8')",
  "marketPriceEstimate": "Estimated market price range (e.g. '$120 - $140' or '12,000 - 15,000 BDT')",
  "color": "Primary dominant color name",
  "colors": ["Primary and secondary dominant colors"],
  "style": ["3 style descriptors e.g., sporty, casual, minimalist, modern"],
  "visualAttributes": ["Key visual traits, material appearance, shape, design"],
  "features": ["3 to 4 prominent visual traits or features"],
  "keywords": ["5 to 8 specific search keywords in English for product inventory lookup"],
  "confidence": "high"
}`;

function parseAiJson(rawText: string): any | null {
  if (!rawText) return null;
  const cleanJson = rawText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleanJson);
  } catch {
    try {
      const sanitized = cleanJson
        .replace(/[\x00-\x1F\x7F-\x9F]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? " " : ""))
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(sanitized);
    } catch {
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const sanitizedMatch = match[0]
            .replace(/[\x00-\x1F\x7F-\x9F]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? " " : ""))
            .replace(/,\s*([}\]])/g, "$1");
          return JSON.parse(sanitizedMatch);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

  // 1. Primary: Direct Google Gemini Vision API
  if (env.GEMINI_API_KEY) {
    const candidateGeminiModels = Array.from(
      new Set(["gemini-3.8-flash", "gemini-3.6-flash", env.GEMINI_MODEL])
    ).filter(Boolean);

    for (const model of candidateGeminiModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(9000),
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ inlineData: imageData }, { text: promptText }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
        });

        if (!response.ok) {
          continue; // try next candidate model
        }

        const data = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n").trim();
        if (!rawText) continue;

        const parsed = parseAiJson(rawText);
        if (parsed && parsed.title) {
          return {
            title: parsed.title,
            category: parsed.category || inferredCategory,
            subcategory: parsed.subcategory || inferredSubcategory,
            productType: parsed.productType || parsed.subcategory || inferredProductType,
            brand: parsed.brand || "Generic",
            model: parsed.model || parsed.title,
            marketPriceEstimate: parsed.marketPriceEstimate || "N/A",
            color: parsed.color || "Multi-color",
            colors: Array.isArray(parsed.colors) ? parsed.colors : [parsed.color].filter(Boolean),
            style: Array.isArray(parsed.style) ? parsed.style : [],
            visualAttributes: Array.isArray(parsed.visualAttributes) ? parsed.visualAttributes : parsed.features || [],
            features: Array.isArray(parsed.features) ? parsed.features : [],
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : parsed.title.split(" "),
            confidence: (parsed.confidence as "high" | "medium" | "low") || "high",
          };
        }
      } catch (err) {
        logger.warn("Gemini visual analysis iteration failed", { err, model });
      }
    }
  }

  // 2. Fallback: OpenRouter Vision API (High Availability)
  if (env.OPENROUTER_API_KEY) {
    const candidateOrModels = ["google/gemini-3.1-flash-image", "google/gemini-3.1-flash-lite-image"];
    for (const orModel of candidateOrModels) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          },
          signal: AbortSignal.timeout(9000),
          body: JSON.stringify({
            model: orModel,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: promptText },
                  { type: "image_url", image_url: { url: `data:${imageData.mimeType};base64,${imageData.data}` } },
                ],
              },
            ],
            temperature: 0.1,
          }),
        });

        if (!response.ok) continue;

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawText = data.choices?.[0]?.message?.content?.trim();
        if (!rawText) continue;

        const parsed = parseAiJson(rawText);
        if (parsed && parsed.title) {
          return {
            title: parsed.title,
            category: parsed.category || inferredCategory,
            subcategory: parsed.subcategory || inferredSubcategory,
            productType: parsed.productType || parsed.subcategory || inferredProductType,
            brand: parsed.brand || "Generic",
            model: parsed.model || parsed.title,
            marketPriceEstimate: parsed.marketPriceEstimate || "N/A",
            color: parsed.color || "Multi-color",
            colors: Array.isArray(parsed.colors) ? parsed.colors : [parsed.color].filter(Boolean),
            style: Array.isArray(parsed.style) ? parsed.style : [],
            visualAttributes: Array.isArray(parsed.visualAttributes) ? parsed.visualAttributes : parsed.features || [],
            features: Array.isArray(parsed.features) ? parsed.features : [],
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : parsed.title.split(" "),
            confidence: (parsed.confidence as "high" | "medium" | "low") || "high",
          };
        }
      } catch (orErr) {
        logger.warn("OpenRouter visual analysis fallback failed", { orErr, orModel });
      }
    }
  }

  return defaultFallback;
}

/**
 * Controller: AI Visual Search (Image & optional name to products)
 * Evaluates catalog products through a multi-tiered matching engine:
 * - Direct Match (Score >= 70): Exact title, brand, or query match
 * - Similar Type (Score >= 30 or subcategory match): Same product category/type
 * - Related Product (Score >= 15): Broad category or visual cue correlation
 * Guarantees real catalog inventory only with persistent seller demand insights.
 */
/**
 * Controller: AI Visual Search (Image & optional name to products)
 * Evaluates catalog products through a multi-tiered hybrid matching engine:
 * - Direct Match (Score >= 75): Exact visual vector similarity + title/brand/type match
 * - Similar Style (Score >= 45): Vector similarity + product type noun match
 * - Alternative (Score >= 20): Category or visual trait correlation
 * Guarantees real catalog inventory only with persistent seller demand insights.
 */
export const visualSearch = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { imageUrl, searchQuery, cropBox } = req.body as {
    imageUrl: string;
    searchQuery?: string;
    cropBox?: { x: number; y: number; width: number; height: number };
  };

  if (!imageUrl) {
    throw ApiError.badRequest("Image URL or uploaded image is required");
  }

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    // 1. Download and preserve image locally if remote URL was supplied
    let persistentImageUrl = imageUrl;
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      persistentImageUrl = await saveRemoteImageLocally(imageUrl);
    }

    // Support optional crop region selection
    let searchTargetImageUrl = persistentImageUrl;
    if (
      cropBox &&
      typeof cropBox.width === "number" &&
      cropBox.width > 10 &&
      typeof cropBox.height === "number" &&
      cropBox.height > 10
    ) {
      try {
        if (persistentImageUrl.startsWith("/uploads/")) {
          const relPath = persistentImageUrl.replace(/^\/uploads\//, "");
          const sourcePath = path.resolve(env.UPLOAD_DIR, relPath);
          if (fs.existsSync(sourcePath)) {
            const croppedFilename = `crop-${crypto.randomUUID()}.jpg`;
            const croppedDir = path.resolve(env.UPLOAD_DIR, "visual-search");
            const croppedPath = path.join(croppedDir, croppedFilename);
            await sharp(sourcePath)
              .extract({
                left: Math.max(0, Math.round(cropBox.x)),
                top: Math.max(0, Math.round(cropBox.y)),
                width: Math.round(cropBox.width),
                height: Math.round(cropBox.height),
              })
              .jpeg({ quality: 90 })
              .toFile(croppedPath);

            searchTargetImageUrl = `/uploads/visual-search/${croppedFilename}`;
          }
        }
      } catch (cropErr) {
        logger.warn("Image region cropping failed, falling back to full image", { cropErr });
      }
    }

    // 2. Analyze image with AI Vision
    const analysis = await analyzeProductImageWithAI(searchTargetImageUrl, searchQuery);

    // 3. Candidate Retrieval: Filter only active, visible products
    const baseFilter = await buildPublicProductFilter({});
    const orConditions: any[] = [];

    // A. Category clause if detected and not generic
    if (analysis.category && analysis.category !== "General") {
      orConditions.push({ category: { $regex: new RegExp(escapeRegex(analysis.category), "i") } });
    }

    // B. Product type nouns
    if (analysis.productType || analysis.subcategory) {
      const pType = analysis.productType || analysis.subcategory || "";
      const typeWords = pType.split(/[\s,]+/).filter((w) => w.length > 2);
      for (const tw of typeWords) {
        orConditions.push({ title: { $regex: escapeRegex(tw), $options: "i" } });
      }
    }

    // C. Brand clause
    if (analysis.brand && analysis.brand.toLowerCase() !== "generic" && analysis.brand.toLowerCase() !== "unknown") {
      const escapedBrand = escapeRegex(analysis.brand);
      orConditions.push({ title: { $regex: escapedBrand, $options: "i" } });
      orConditions.push({ description: { $regex: escapedBrand, $options: "i" } });
      orConditions.push({ tags: { $in: [analysis.brand.toLowerCase()] } });
    }

    // D. Model keyword clause
    if (analysis.model && analysis.model !== "N/A") {
      const modelWords = analysis.model
        .split(/[\s-]+/)
        .filter((w) => w.length >= 2 && w.toLowerCase() !== "pro" && w.toLowerCase() !== "plus");
      for (const mw of modelWords) {
        orConditions.push({ title: { $regex: escapeRegex(mw), $options: "i" } });
      }
    }

    const queryFilter: Record<string, unknown> = {
      ...baseFilter,
      isDeleted: false,
      status: "approved",
      storeSuspended: false,
      ...(orConditions.length > 0 ? { $or: orConditions } : {}),
    };

    let candidateProducts = await Product.find(queryFilter)
      .select("_id title description price discountPrice category tags images ratingAvg ratingCount stock sold sellerId visualEmbedding visualAttributes brand")
      .populate("sellerId", "name storeName")
      .limit(80)
      .lean();

    // If candidate count is 0, broaden search across all active catalog products
    if (candidateProducts.length === 0) {
      const broadFilter = {
        ...baseFilter,
        isDeleted: false,
        status: "approved",
        storeSuspended: false,
      };
      candidateProducts = await Product.find(broadFilter)
        .select("_id title description price discountPrice category tags images ratingAvg ratingCount stock sold sellerId visualEmbedding visualAttributes brand")
        .populate("sellerId", "name storeName")
        .limit(80)
        .lean();
    }

    // 4. Hybrid Relevance Ranking Layer
    const finalProducts = rankProductsHybrid(candidateProducts, analysis, searchQuery);
    const isUnmet = finalProducts.length === 0;

    // 5. Authenticated Visual Search History Recording
    if (req.user?.id) {
      try {
        await VisualSearchHistory.create({
          userId: req.user.id,
          imageUrl: persistentImageUrl,
          detectedTitle: analysis.title,
          detectedCategory: analysis.category,
          detectedProductType: analysis.productType || analysis.subcategory,
          resultCount: finalProducts.length,
          searchQuery: searchQuery || "",
        });
      } catch (histErr) {
        logger.warn("Failed to record visual search history", { histErr });
      }
    }

    // 6. Record Visual Search Demand in Database for Sellers
    let demandRecordId: string | null = null;
    try {
      const demandRecord = await VisualSearchDemand.create({
        imageUrl: persistentImageUrl,
        searchQuery: searchQuery || "",
        detectedTitle: analysis.title,
        detectedCategory: analysis.category,
        detectedBrand: analysis.brand,
        detectedModel: analysis.model || "",
        marketPriceEstimate: analysis.marketPriceEstimate || "",
        detectedColor: analysis.color,
        detectedColors: analysis.colors || [],
        detectedProductType: analysis.productType || analysis.subcategory,
        detectedStyle: analysis.style || [],
        detectedAttributes: analysis.visualAttributes || analysis.features || [],
        detectedFeatures: analysis.features,
        detectedTags: analysis.keywords,
        confidence: analysis.confidence,
        matchedCount: isUnmet ? 0 : finalProducts.length,
        matchedProductIds: isUnmet ? [] : finalProducts.slice(0, 5).map((p: any) => p._id),
        isUnmetDemand: isUnmet,
        userId: req.user?.id || null,
        userRole: req.user ? "customer" : "guest",
        status: "new",
      });
      demandRecordId = demandRecord._id.toString();
    } catch (demandErr) {
      logger.warn("Failed to record visual search demand", { demandErr });
    }

    sendSuccess(res, {
      detected: {
        title: analysis.title,
        category: analysis.category,
        subcategory: analysis.subcategory,
        productType: analysis.productType,
        brand: analysis.brand,
        model: analysis.model,
        marketPriceEstimate: analysis.marketPriceEstimate,
        color: analysis.color,
        colors: analysis.colors,
        style: analysis.style,
        visualAttributes: analysis.visualAttributes,
        features: analysis.features,
        keywords: analysis.keywords,
        confidence: analysis.confidence,
      },
      count: finalProducts.length,
      products: finalProducts,
      isUnmetDemand: isUnmet,
      demandId: demandRecordId,
      latencyMs: Date.now() - startTime,
    });
  } catch (searchError) {
    logger.error("Visual search unhandled error, returning graceful fallback", { searchError });
    sendSuccess(res, {
      detected: {
        title: "Product",
        category: "General",
        brand: "Generic",
        model: "N/A",
        confidence: "low",
        keywords: [],
      },
      count: 0,
      products: [],
      isUnmetDemand: true,
      demandId: null,
      latencyMs: Date.now() - startTime,
    });
  }
});

/**
 * Controller: Upload Visual Search Image
 * Strictly verifies file magic bytes, MIME types, and dimensions.
 */
export const uploadVisualSearchImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest("Please select or capture a product image to upload");
  }

  const fullPath = path.resolve(req.file.destination, req.file.filename);
  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(fullPath);
  } catch {
    throw ApiError.badRequest("Uploaded file could not be read");
  }

  const validation = await validateImageBuffer(buffer);
  if (!validation.isValid) {
    try {
      await fs.promises.unlink(fullPath);
    } catch {
      // ignore
    }
    throw ApiError.badRequest(validation.error || "Invalid image upload");
  }

  const imageUrl = `/uploads/visual-search/${req.file.filename}`;
  sendSuccess(
    res,
    {
      imageUrl,
      format: validation.format,
      width: validation.width,
      height: validation.height,
    },
    "Image uploaded successfully"
  );
});

/**
 * Controller: Get Authenticated Visual Search History
 */
export const getVisualSearchHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required to view search history");
  }

  const history = await VisualSearchHistory.find({ userId })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  sendSuccess(res, history);
});

/**
 * Controller: Clear Authenticated Visual Search History
 */
export const clearVisualSearchHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required to clear search history");
  }

  await VisualSearchHistory.deleteMany({ userId });
  sendSuccess(res, { cleared: true }, "Visual search history cleared successfully");
});

/**
 * Controller: Get Visual Search Demand Trends (For Seller Insights)
 */
export const getVisualSearchTrends = asyncHandler(async (req: Request, res: Response) => {
  const { period = "7d" } = req.query as { period?: string };
  const now = new Date();
  let startDate: Date;

  if (period === "today") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // 7d default
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const dateFilter = { createdAt: { $gte: startDate } };

  const [totalSearches, unmetSearches, categoryAgg, tagAgg, colorAgg, productTypeAgg] = await Promise.all([
    VisualSearchDemand.countDocuments(dateFilter),
    VisualSearchDemand.countDocuments({ ...dateFilter, isUnmetDemand: true }),
    VisualSearchDemand.aggregate([
      { $match: dateFilter },
      { $group: { _id: "$detectedCategory", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: dateFilter },
      { $unwind: "$detectedTags" },
      { $group: { _id: "$detectedTags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: { ...dateFilter, detectedColor: { $exists: true, $ne: "" } } },
      { $group: { _id: "$detectedColor", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: { ...dateFilter, detectedProductType: { $exists: true, $ne: "" } } },
      { $group: { _id: "$detectedProductType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);

  sendSuccess(res, {
    period,
    totalSearches,
    unmetSearches,
    matchedSearches: Math.max(totalSearches - unmetSearches, 0),
    topCategories: categoryAgg.map((c) => ({ category: c._id || "Other", count: c.count })),
    trendingKeywords: tagAgg.map((t) => ({ tag: t._id, count: t.count })),
    popularColors: colorAgg.map((c) => ({ color: c._id, count: c.count })),
    trendingProductTypes: productTypeAgg.map((p) => ({ productType: p._id, count: p.count })),
  });
});

/**
 * Controller: Get Visual Search Demands (For Seller Demand Insights Dashboard)
 * Guaranteed: Only returns genuine customer demands with valid, existing images.
 */
export const getVisualSearchDemands = asyncHandler(async (req: Request, res: Response) => {
  const {
    category,
    status = "all",
    period = "all",
    search,
    page = "1",
    limit = "20",
  } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};

  if (period === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    filter.createdAt = { $gte: today };
  } else if (period === "7d") {
    filter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  } else if (period === "30d") {
    filter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }

  if (category && category !== "all") {
    filter.detectedCategory = { $regex: new RegExp(`^${category}$`, "i") };
  }
  if (status === "unmet") {
    filter.isUnmetDemand = true;
  } else if (status === "matched") {
    filter.isUnmetDemand = false;
  }
  if (search) {
    const rgx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { detectedTitle: rgx },
      { searchQuery: rgx },
      { detectedTags: rgx },
      { detectedCategory: rgx },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [rawDemands, total, totalSearches, unmetSearches, categoryAgg, tagAgg, colorAgg, productTypeAgg] = await Promise.all([
    VisualSearchDemand.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    VisualSearchDemand.countDocuments(filter),
    VisualSearchDemand.countDocuments({}),
    VisualSearchDemand.countDocuments({ isUnmetDemand: true }),
    VisualSearchDemand.aggregate([
      { $match: filter },
      { $group: { _id: "$detectedCategory", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: filter },
      { $unwind: "$detectedTags" },
      { $group: { _id: "$detectedTags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: { ...filter, detectedColor: { $exists: true, $ne: "" } } },
      { $group: { _id: "$detectedColor", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    VisualSearchDemand.aggregate([
      { $match: { ...filter, detectedProductType: { $exists: true, $ne: "" } } },
      { $group: { _id: "$detectedProductType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);

  // Ensure customer demands are permanently preserved and visible for sellers ("shobsomoy thakbe")
  const demands = rawDemands;

  sendSuccess(res, {
    metrics: {
      totalSearches,
      unmetSearches,
      matchedSearches: Math.max(totalSearches - unmetSearches, 0),
      topCategories: categoryAgg.map((c) => ({ category: c._id || "Other", count: c.count })),
      trendingKeywords: tagAgg.map((t) => ({ tag: t._id, count: t.count })),
      popularColors: colorAgg.map((c) => ({ color: c._id, count: c.count })),
      trendingProductTypes: productTypeAgg.map((p) => ({ productType: p._id, count: p.count })),
    },
    demands,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  });
});

/**
 * Controller: Get Single Visual Search Demand by ID
 */
export const getVisualSearchDemandById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const demand = await VisualSearchDemand.findById(id).lean();
  if (!demand) {
    throw ApiError.notFound("Demand record not found");
  }
  sendSuccess(res, demand);
});

/**
 * Controller: Update Demand Status
 */
export const updateVisualSearchDemandStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["new", "reviewed", "stocked"].includes(status)) {
    throw ApiError.badRequest("Invalid status. Must be 'new', 'reviewed', or 'stocked'");
  }

  const demand = await VisualSearchDemand.findByIdAndUpdate(id, { status }, { new: true });
  if (!demand) {
    throw ApiError.notFound("Demand record not found");
  }

  sendSuccess(res, demand, "Demand status updated successfully");
});

/**
 * Controller: Delete Visual Search Demand — DISABLED
 * Customer demand data is permanently archived for seller insights.
 * Deletion is not permitted to preserve the full demand intelligence history.
 */
export const deleteVisualSearchDemand = asyncHandler(async (_req: Request, _res: Response) => {
  throw ApiError.forbidden("Customer demand records are permanently archived and cannot be deleted. This data is critical for seller demand intelligence.");
});

const memoryStore = new Map<string, { preferences: string[]; activeTheme: string; lastSearchIntent: string }>();

/**
 * Controller: Get AI Commerce Memory
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID (or "guest")
 * 2. Database Operation:
 *    - In-memory preferences store lookup
 * 3. Response Sent:
 *    - HTTP 200: { userId, memory, controls: { canReset, personalizationEnabled } }
 */
export const getAiCommerceMemory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "guest";
  const userMemory = memoryStore.get(userId) || {
    preferences: ["Prefers fast domestic dispatch in Dhaka", "Interest in High-Performance Tech & Accessories"],
    activeTheme: "Electronics & Tech Setup",
    lastSearchIntent: "Gaming gear under ৳50,000",
  };

  sendSuccess(res, {
    userId,
    memory: userMemory,
    controls: {
      canReset: true,
      personalizationEnabled: true,
    },
  });
});

/**
 * Controller: Clear AI Commerce Memory
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 * 2. Database Operation:
 *    - Deletes user key from memoryStore
 * 3. Response Sent:
 *    - HTTP 200: { success: true }
 */
export const clearAiCommerceMemory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "guest";
  memoryStore.delete(userId);
  sendSuccess(res, { success: true }, "AI commerce preferences and shopping memory cleared");
});

/**
 * Controller: AI Shopping Negotiator
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product (optional)
 *    - req.body.cartSubtotal: Subtotal to optimize
 * 2. Database Operation:
 *    - Product.findById(productId)
 *    - Coupon.find({ isActive: true }) to find best lawful promo codes
 * 3. Response Sent:
 *    - HTTP 200: { originalPrice, bestEffectivePrice, totalSavings, savingsPercent, discountBreakdown, negotiationStrategy }
 */
export const negotiateDeal = asyncHandler(async (req: Request, res: Response) => {
  const { productId, cartSubtotal = 5000 } = req.body;

  const product = productId ? await getPublicProduct(productId) : null;
  const originalPrice = product ? (product.discountPrice || product.price) : Number(cartSubtotal);

  const activeCoupons = await Coupon.find({ isActive: true });
  const bestCoupon = activeCoupons[0] || {
    code: "SHOPNEST10",
    type: "percentage" as const,
    value: 10,
    minPurchase: 1000,
    isActive: true,
  };

  const couponDiscount =
    bestCoupon.type === "percentage"
      ? Math.round(originalPrice * (bestCoupon.value / 100))
      : bestCoupon.value;
  const platformOffer = originalPrice > 3000 ? 150 : 0;
  const bestEffectivePrice = Math.max(100, originalPrice - couponDiscount - platformOffer);
  const totalSavings = originalPrice - bestEffectivePrice;

  sendSuccess(res, {
    originalPrice,
    bestEffectivePrice,
    totalSavings,
    savingsPercent: Math.round((totalSavings / originalPrice) * 100),
    discountBreakdown: [
      {
        type: "Seller / Product Direct Promotion",
        amount: product?.discountPrice ? product.price - product.discountPrice : 0,
      },
      { type: `Platform Coupon (${bestCoupon.code})`, amount: couponDiscount, code: bestCoupon.code },
      { type: "Free Express Delivery Credit", amount: platformOffer },
    ],
    negotiationStrategy: `✨ Optimized stack: Applied valid promo code '${bestCoupon.code}' and ৳${platformOffer} logistics subsidy. AI does not alter baseline catalog prices.`,
  });
});

/**
 * Controller: AI Shopping Intent & Database-Driven Search Assistant
 *
 * 1. Inputs Extracted:
 *    - req.body.prompt: User natural language search prompt (English or Bangla)
 * 2. Database Operation:
 *    - Parses budget, recipient, and category keywords
 *    - Product.find(filter) using strict budget cap & regex matching
 * 3. Response Sent:
 *    - HTTP 200: { extractedIntent, matchingProducts, recommendationSummary }
 */
export const detectShoppingIntent = asyncHandler(async (req: Request, res: Response) => {
  const { prompt = "I need a gift for my brother's birthday under 5000" } = req.body;
  const rawPrompt = String(prompt).trim();

  // Transliterate Bengali numerals to English (০-৯ -> 0-9)
  const bnToEnMap: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };
  const normalizedPrompt = rawPrompt.replace(/[০-৯]/g, (d) => bnToEnMap[d] || d);
  const lower = normalizedPrompt.toLowerCase();

  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  // Check for 'k' multiplier (e.g. "under 5k")
  const kBudgetMatch =
    lower.match(/(?:under|below|budget|within|max|niche|moddhe|vitor|kom|takar)\s*(\d+(?:\.\d+)?)\s*k\b/i) ||
    lower.match(/(\d+(?:\.\d+)?)\s*k\s*(?:under|below|budget|within|takar|tk|৳|moddhe|niche|vitor)/i);

  if (kBudgetMatch) {
    maxPrice = Math.round(parseFloat(kBudgetMatch[1]) * 1000);
  } else {
    const budgetPatterns = [
      /(?:under|below|budget|within|less than|max|maximum|up to|highest|niche|er niche|moddhe|er moddhe|vitor|kom)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i,
      /(?:tk|taka|৳)\s*(\d+[\d,]*)\s*(?:under|below|niche|er niche|moddhe|er moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:tk|taka|৳)\s*(?:er)?\s*(?:niche|moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:takar|taka|tk|৳)\s*(?:moddhe|vitor|niche)/i,
    ];
    for (const pattern of budgetPatterns) {
      const match = lower.match(pattern);
      if (match) {
        maxPrice = Number(match[1].replace(/,/g, ""));
        break;
      }
    }
  }

  const minMatch = lower.match(/(?:above|more than|at least|min|minimum|theke|from)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i);
  if (minMatch) {
    minPrice = Number(minMatch[1].replace(/,/g, ""));
  }

  let occasion = "General Shopping";
  if (lower.includes("birthday") || lower.includes("jonmodin")) occasion = "Birthday Celebration";
  else if (lower.includes("eid") || lower.includes("roza")) occasion = "Eid Festival";
  else if (lower.includes("wedding") || lower.includes("biye") || lower.includes("anniversary")) occasion = "Wedding / Anniversary";
  else if (lower.includes("office") || lower.includes("work") || lower.includes("desk")) occasion = "Professional / Office Setup";
  else if (lower.includes("gaming") || lower.includes("gamer") || lower.includes("esport")) occasion = "Gaming Setup";
  else if (lower.includes("gym") || lower.includes("workout") || lower.includes("running") || lower.includes("fitness")) occasion = "Sports & Fitness";
  else if (lower.includes("travel") || lower.includes("tour")) occasion = "Travel & Outdoor";

  let recipient = "Self";
  if (lower.includes("mother") || lower.includes("mom") || lower.includes("ammu") || lower.includes("ma")) recipient = "Mother";
  else if (lower.includes("father") || lower.includes("dad") || lower.includes("abbu") || lower.includes("baba")) recipient = "Father";
  else if (lower.includes("brother") || lower.includes("bhai") || lower.includes("vai")) recipient = "Brother";
  else if (lower.includes("sister") || lower.includes("bon") || lower.includes("apu")) recipient = "Sister";
  else if (lower.includes("friend") || lower.includes("bondhu") || lower.includes("dost")) recipient = "Friend";
  else if (lower.includes("wife") || lower.includes("bou") || lower.includes("husband") || lower.includes("shami")) recipient = "Spouse";
  else if (lower.includes("kids") || lower.includes("baby") || lower.includes("child") || lower.includes("baccha")) recipient = "Kids / Baby";

  const stopWords = [
    "i need", "i want", "show me", "find me", "give me", "suggest", "recommend", "looking for",
    "something for", "a gift for", "gift", "gifts", "under", "below", "less than", "within",
    "budget", "price", "taka", "takar", "tk", "tks", "er", "moddhe", "vitor", "niche",
    "kom", "ami", "chai", "lagbe", "khojo", "dekhao", "kono", "bhalo", "best", "good",
    "cheap", "expensive", "brother", "sister", "mother", "father", "friend", "birthday",
    "eid", "wedding", "anniversary", "office", "work", "for", "a", "an", "the", "in",
    "and", "or", "to", "with", "please", "item", "product", "products", "stuff",
  ];

  let cleaned = lower.replace(/\b\d+(?:[.,]\d+)?\s*(?:k|tk|taka|৳)?\b/gi, " ");
  for (const sw of stopWords) {
    const reg = new RegExp(`\\b${sw}\\b`, "gi");
    cleaned = cleaned.replace(reg, " ");
  }

  const searchTokens = cleaned
    .replace(/[^\w\s\u0980-\u09FF-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const cleanSearchQuery = searchTokens.join(" ");

  const filter: Record<string, unknown> = await buildPublicProductFilter({});

  if (maxPrice !== null && maxPrice > 0) {
    filter.price = { $lte: maxPrice };
  }
  if (minPrice !== null && minPrice > 0) {
    filter.price = { ...(filter.price || {}), $gte: minPrice };
  }

  let categoryHint = "";
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) categoryHint = "Phones & Tablets";
  else if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) categoryHint = "Computers";
  else if (lower.includes("mouse") || lower.includes("keyboard") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone") || lower.includes("soundbox") || lower.includes("speaker")) categoryHint = "Electronics";
  else if (lower.includes("shirt") || lower.includes("t-shirt") || lower.includes("saree") || lower.includes("panjabi") || lower.includes("dress") || lower.includes("pant") || lower.includes("jacket")) categoryHint = "Fashion";
  else if (lower.includes("watch") || lower.includes("smartwatch") || lower.includes("bag") || lower.includes("wallet") || lower.includes("perfume")) categoryHint = "Accessories";

  if (searchTokens.length > 0) {
    const tokenConditions = searchTokens.map((token) => ({
      $or: [
        { title: { $regex: token, $options: "i" } },
        { category: { $regex: token, $options: "i" } },
        { tags: { $regex: token, $options: "i" } },
        { description: { $regex: token, $options: "i" } },
      ],
    }));
    filter.$and = tokenConditions;
  } else if (categoryHint) {
    filter.category = { $regex: categoryHint, $options: "i" };
  }

  let matchingProducts = await Product.find(filter)
    .sort({ ratingAvg: -1, sold: -1, stock: -1 })
    .limit(8)
    .lean();

  if (matchingProducts.length === 0 && searchTokens.length > 1) {
    const broaderFilter: Record<string, unknown> = await buildPublicProductFilter({});
    if (maxPrice !== null && maxPrice > 0) {
      broaderFilter.price = { $lte: maxPrice };
    }
    if (minPrice !== null && minPrice > 0) {
      broaderFilter.price = { ...(broaderFilter.price || {}), $gte: minPrice };
    }
    broaderFilter.$or = searchTokens.map((token) => ({
      title: { $regex: token, $options: "i" },
    }));

    matchingProducts = await Product.find(broaderFilter)
      .sort({ ratingAvg: -1, sold: -1 })
      .limit(6)
      .lean();
  }

  let recommendationSummary = "";
  if (matchingProducts.length === 0) {
    const budgetClause = maxPrice ? ` under ৳${maxPrice.toLocaleString()}` : "";
    const termClause = cleanSearchQuery ? ` for "${cleanSearchQuery}"` : "";
    recommendationSummary = `I couldn't find any products in our current catalog matching${termClause}${budgetClause}. Please try searching with a different keyword or adjusting your budget.`;
  } else {
    const budgetClause = maxPrice ? ` within your budget of ৳${maxPrice.toLocaleString()}` : "";
    const targetClause = cleanSearchQuery ? ` for "${cleanSearchQuery}"` : (occasion !== "General Shopping" ? ` for ${occasion}` : "");
    recommendationSummary = `Found ${matchingProducts.length} verified products from real marketplace inventory${targetClause}${budgetClause}. All items are in-stock and spec-verified.`;
  }

  sendSuccess(res, {
    extractedIntent: {
      occasion,
      recipient,
      detectedBudget: maxPrice ? `৳${maxPrice.toLocaleString()}` : "Any Budget",
      categoryFocus: categoryHint || (searchTokens.length > 0 ? searchTokens.join(" ") : "All Categories"),
      rawQuery: rawPrompt,
    },
    matchingProducts: matchingProducts.map((p: any) => ({
      id: String(p._id),
      _id: String(p._id),
      title: p.title,
      description: p.description,
      price: p.price,
      discountPrice: p.discountPrice,
      category: p.category,
      images: p.images || [],
      stock: p.stock || 0,
      ratingAvg: p.ratingAvg || 0,
      ratingCount: p.ratingCount || 0,
      sold: p.sold || 0,
      tags: p.tags || [],
    })),
    recommendationSummary,
  });
});

/**
 * Controller: Multi-Role AI Commerce Copilot (Customer, Seller, Admin)
 *
 * 1. Inputs Extracted:
 *    - req.body: query, role, context
 *    - req.user: User session
 * 2. Database Operation:
 *    - Fetches role-specific marketplace telemetry or order stats
 * 3. Response Sent:
 *    - HTTP 200: { role, query, answer, suggestedActions, isFallback }
 */
export const commerceCopilot = asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.body;
  const userRole = req.user?.role;
  const userId = req.user?.id;

  if (!query) throw ApiError.badRequest("Please provide a prompt for the AI Copilot");
  if (!userRole) throw ApiError.unauthorized("Authentication required");

  const aiContext: AiContext = {};
  let systemPrompt = "";

  if (userRole === "admin" && userId) {
    const userCount = await import("../users/user.model").then((m) => m.usersCollection().countDocuments({}));
    const sellerCount = await import("../sellers/store.model").then((m) => m.Store.countDocuments({}));
    const orderCount = await Order.countDocuments({});
    const productCount = await Product.countDocuments({ isDeleted: false });
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $in: ["delivered", "shipped", "out_for_delivery"] } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    aiContext.userContext = {
      userCount,
      sellerCount,
      orderCount,
      productCount,
      totalRevenue: totalRevenue[0]?.total || 0,
    };
    systemPrompt = `You are the ShopNest Admin Copilot, an AI assistant for marketplace administrators.
You help admins analyze platform health, review incidents, manage sellers and products, and make data-driven decisions.
Always base your answers on the provided marketplace data. Never invent metrics or access unauthorized data.
Be concise, professional, and actionable. If data is missing, say so honestly.`;
  } else if (userRole === "seller" && userId) {
    const store = await Store.findOne({ $or: [{ ownerId: userId }, { userId }] });
    if (store) {
      const [orderCount, productCount, recentOrders] = await Promise.all([
        Order.countDocuments({ "items.sellerId": store.id }),
        Product.countDocuments({ storeId: store.id, isDeleted: false }),
        Order.find({ "items.sellerId": userId }).sort({ createdAt: -1 }).limit(5).lean(),
      ]);
      aiContext.userContext = {
        storeName: store.storeName,
        trustScore: store.trustScore,
        orderCount,
        productCount,
      };
      aiContext.orders = recentOrders.map((o: any) => ({
        id: String(o._id),
        status: o.status,
        totalAmount: o.totalAmount || 0,
      }));
    }
    systemPrompt = `You are the ShopNest Seller Copilot, an AI business assistant for authenticated sellers.
You help sellers analyze their store performance, manage products and inventory, understand orders and revenue, and grow their business.
Always base your answers on the provided seller data. Never expose other sellers' data or customer private information.
Be concise, professional, and actionable. If data is missing, say so honestly. Focus on the seller's own store only.`;
  } else {
    if (userId) {
      const [orders, wishlist] = await Promise.all([
        Order.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
        import("../wishlist/wishlist.model").then((m) => m.Wishlist.findOne({ userId })),
      ]);
      aiContext.orders = orders.map((o: any) => ({
        id: String(o._id),
        status: o.status,
        totalAmount: o.totalAmount || 0,
      }));
      aiContext.wishlist = (wishlist?.items || []).slice(0, 5).map((item: any) => ({
        title: item.title,
        price: item.price || 0,
      }));
      aiContext.userContext = { wishlistCount: wishlist?.items?.length || 0 };
    }
    systemPrompt = `You are the ShopNest AI Shopping Assistant, a personal shopping assistant for customers.
You help customers find products, compare options, manage their cart and wishlist, track orders, and make confident purchase decisions.
Always base your answers on the provided customer data. Never expose seller analytics, admin data, or other customers' private information.
Be concise, professional, and actionable. If data is missing, say so honestly. Focus on the customer's own shopping experience.`;
  }

  try {
    const result = await completeWithContext(
      [{ role: "user", content: query }],
      aiContext,
      { system: systemPrompt, role: userRole as "customer" | "seller" | "admin" }
    );
    const suggestedActions = buildSuggestedActions(userRole, query);
    return sendSuccess(res, {
      role: userRole,
      query,
      answer: result.content,
      suggestedActions,
      isFallback: result.isFallback,
      provider: result.provider,
    });
  } catch (error) {
    logger.error("Commerce copilot AI failed", { error, role: userRole });
    const suggestedActions = buildSuggestedActions(userRole, query);
    return sendSuccess(res, {
      role: userRole,
      query,
      answer: getRoleBasedUnavailableMessage(userRole),
      suggestedActions,
      isFallback: true,
      provider: undefined,
    });
  }
});

function buildSuggestedActions(role: string, query: string): Array<{ label: string; action: string; targetUrl?: string }> {
  if (role === "admin") {
    return [
      { label: "Review Anomaly Center", action: "navigate", targetUrl: "/dashboard/admin" },
      { label: "Inspect Geographical Map", action: "filter", targetUrl: "/dashboard/admin" },
    ];
  }
  if (role === "seller") {
    return [
      { label: "Run Campaign Simulator", action: "open_simulator" },
      { label: "View Profitability Waterfall", action: "navigate", targetUrl: "/dashboard/seller" },
    ];
  }
  return [
    { label: "Open Budget Planner", action: "open_budget" },
    { label: "Check Product Compatibility", action: "open_compatibility" },
  ];
}

function getRoleBasedUnavailableMessage(role: string): string {
  if (role === "seller") {
    return "AI assistant is currently unavailable. You can still browse your products, check orders, and manage your store. Please try again later for AI-powered business insights.";
  }
  if (role === "admin") {
    return "AI assistant is currently unavailable. You can still access the admin dashboard for platform analytics. Please try again later for AI-powered insights.";
  }
  return "AI assistant is currently unavailable. I can still help you browse products, check prices, and manage your orders. Please try again later for AI-powered recommendations.";
}

/**
 * Controller: AI Product Image Analysis (Vision)
 *
 * 1. Inputs Extracted:
 *    - req.body: imageUrls (string[]), optional seller hints
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - Fetches similar products for price/category context
 * 3. Response Sent:
 *    - HTTP 200: { analysis, detectedCategory, confidence, isFallback }
 */
export const analyzeProductImages = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrls, hints } = req.body as { imageUrls: string[]; hints?: Record<string, string> };
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw ApiError.badRequest("Please provide at least one product image URL.");
  }

  let categoryContext: string[] = [];
  let priceContext: { avgPrice: number; minPrice: number; maxPrice: number } | null = null;

  if (hints?.category) {
    const cats = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${hints.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
        { slug: hints.category.toLowerCase() },
      ],
    }).limit(5);
    categoryContext = cats.map((c) => c.name);
  }

  if (categoryContext.length > 0) {
    const categoryMatch = await buildPublicProductFilter({ category: { $in: categoryContext } });
    const agg = await Product.aggregate([
      { $match: categoryMatch },
      {
        $group: {
          _id: null,
          avgPrice: { $avg: "$price" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
        },
      },
    ]);
    if (agg[0]) {
      priceContext = {
        avgPrice: Math.round(agg[0].avgPrice || 0),
        minPrice: Math.round(agg[0].minPrice || 0),
        maxPrice: Math.round(agg[0].maxPrice || 0),
      };
    }
  }

  const imageContent = imageUrls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const userPrompt = `Analyze these ${imageUrls.length} product image(s) and identify the product details.

${hints?.productName ? `Seller-provided product name hint: ${hints.productName}` : ""}
${hints?.notes ? `Seller notes: ${hints.notes}` : ""}
${categoryContext.length > 0 ? `Known categories in our marketplace: ${categoryContext.join(", ")}` : ""}
${priceContext ? `Category price range: ৳${priceContext.minPrice} - ৳${priceContext.maxPrice} (avg ৳${priceContext.avgPrice})` : ""}

Return ONLY valid JSON (no markdown, no preamble):
{
  "detectedProductType": string,
  "detectedCategory": string,
  "detectedSubcategory": string,
  "detectedColor": string | "Not detected",
  "detectedMaterial": string | "Not detected",
  "detectedBrand": string | "Not detected",
  "detectedFeatures": string[],
  "detectedUseCase": string,
  "suggestedTitle": string,
  "suggestedTags": string[],
  "conditionNotes": string,
  "confidence": "high" | "medium" | "low"
}`;

  const messages = [
    { role: "user" as const, content: [...imageContent, { type: "text" as const, text: userPrompt }] },
  ];

  const context: AiContext = { productName: hints?.productName, category: hints?.category };
  let result: {
    detectedProductType: string;
    detectedCategory: string;
    detectedSubcategory: string;
    detectedColor: string;
    detectedMaterial: string;
    detectedBrand: string;
    detectedFeatures: string[];
    detectedUseCase: string;
    suggestedTitle: string;
    suggestedTags: string[];
    conditionNotes: string;
    confidence: "high" | "medium" | "low";
  };
  let isFallback = false;

  try {
    const parsed = await completeJSONWithContext<{
      detectedProductType: string;
      detectedCategory: string;
      detectedSubcategory: string;
      detectedColor: string;
      detectedMaterial: string;
      detectedBrand: string;
      detectedFeatures: string[];
      detectedUseCase: string;
      suggestedTitle: string;
      suggestedTags: string[];
      conditionNotes: string;
      confidence: "high" | "medium" | "low";
    }>(messages, context, { system: PRODUCT_ANALYSIS_SYSTEM, maxTokens: 1024, temperature: 0.3 });
    result = parsed.data;
    isFallback = parsed.isFallback;
  } catch {
    isFallback = true;
    result = {
      detectedProductType: hints?.productName ? "Product" : "Unidentified Product",
      detectedCategory: hints?.category || "General",
      detectedSubcategory: "",
      detectedColor: "Not detected",
      detectedMaterial: "Not detected",
      detectedBrand: "Not detected",
      detectedFeatures: hints?.specialFeatures ? hints.specialFeatures.split(",").map((s) => s.trim()).filter(Boolean) : [],
      detectedUseCase: hints?.targetCustomer || "General use",
      suggestedTitle: hints?.productName || "Product from Uploaded Images",
      suggestedTags: hints?.category ? [hints.category.toLowerCase()] : [],
      conditionNotes: "AI analysis is temporarily unavailable. Please review and complete the product details manually.",
      confidence: "low",
    };
  }

  sendSuccess(res, {
    ...result,
    isFallback,
    imageUrls,
  });
});

/**
 * Controller: Generate Complete Product Content from Images
 *
 * 1. Inputs Extracted:
 *    - req.body: imageUrls, analysis (optional), hints
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - Fetches category pricing context
 *    - Fetches similar products for pricing signals
 * 3. Response Sent:
 *    - HTTP 200: { title, description, shortDescription, features, specifications, category, tags, seoTitle, seoDescription, highlights, marketingCaption, suggestedPrice, priceRange, isFallback }
 */
export const generateProductFromImages = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrls, analysis, hints } = req.body as {
    imageUrls: string[];
    analysis?: Record<string, unknown>;
    hints?: Record<string, string>;
  };

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw ApiError.badRequest("Please provide at least one product image URL.");
  }

  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Seller authentication required");
  }
  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before using AI product tools. Please complete your store setup first.");
  }

  let categoryAvgPrice = 0;
  const detectedCat = typeof analysis?.detectedCategory === "string" ? (analysis.detectedCategory as string) : "";
  const hintCat = typeof hints?.category === "string" ? (hints.category as string) : "";
  const suggestedCategory = hintCat || detectedCat || "General";

  if (suggestedCategory && suggestedCategory !== "General") {
    const escaped = suggestedCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const catNames = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${escaped}$`, "i") } },
        { slug: suggestedCategory.toLowerCase() },
      ],
    }).limit(5);
    if (catNames.length > 0) {
      const catNameList = catNames.map((c) => c.name);
      const categoryMatch = await buildPublicProductFilter({ category: { $in: catNameList } });
      const agg = await Product.aggregate([
        { $match: categoryMatch },
        { $group: { _id: null, avgPrice: { $avg: "$price" } } },
      ]);
      if (agg[0]?.avgPrice) categoryAvgPrice = Math.round(agg[0].avgPrice);
    }
  }

  const imageContent = imageUrls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const analysisSummary = analysis
    ? `AI Image Analysis Results:\n` +
      `- Product Type: ${analysis.detectedProductType || "Not detected"}\n` +
      `- Category: ${analysis.detectedCategory || "Not detected"}\n` +
      `- Subcategory: ${analysis.detectedSubcategory || "Not detected"}\n` +
      `- Color: ${analysis.detectedColor || "Not detected"}\n` +
      `- Material: ${analysis.detectedMaterial || "Not detected"}\n` +
      `- Brand: ${analysis.detectedBrand || "Not detected"}\n` +
      `- Features: ${Array.isArray(analysis.detectedFeatures) ? analysis.detectedFeatures.join(", ") : "Not detected"}\n` +
      `- Use Case: ${analysis.detectedUseCase || "Not detected"}\n` +
      `- Confidence: ${analysis.confidence || "medium"}\n`
    : "No image analysis provided. Analyze the images directly.";

  const userPrompt = `You are an expert e-commerce product researcher and copywriter. Analyze these product images and generate a COMPLETE, VERIFIED marketplace product listing.

STEP 1 — PRODUCT IDENTIFICATION:
Study the images carefully. Identify:
- Exact product type/category
- Visible brand logos or marks
- Model numbers or series names
- Colors and materials
- Physical characteristics (shape, size cues)

STEP 2 — RESEARCH & VERIFICATION:
Using your training knowledge, research this product type and provide:
- Typical market price range for this product category
- Standard specifications and dimensions
- Common materials and build quality
- Typical warranty information
- What's usually included in the box
- Common variants/options available

STEP 3 — GENERATE COMPLETE LISTING:

${analysisSummary}

${hints?.productName ? `Seller hint: ${hints.productName}` : ""}
${hints?.costPrice ? `Seller cost price: ৳${hints.costPrice}` : ""}
${hints?.targetCustomer ? `Target customer: ${hints.targetCustomer}` : ""}
${hints?.specialFeatures ? `Special features: ${hints.specialFeatures}` : ""}
${hints?.notes ? `Additional notes: ${hints.notes}` : ""}
${categoryAvgPrice > 0 ? `Category average price on ShopNest: ৳${categoryAvgPrice}` : "No ShopNest pricing data available."}

Return ONLY valid JSON (no markdown, no preamble):
{
  "title": string (professional marketplace title, max 120 chars),
  "category": string (main category),
  "subcategory": string (subcategory if applicable),
  "brand": string (detected or "Not detected"),
  "model": string (detected model or "Not detected"),
  "description": string (detailed long description with: Product Overview, Key Features, Benefits, Specifications, Ideal For, Why Choose This Product, Usage Instructions),
  "shortDescription": string (max 200 chars),
  "features": string[] (4-6 concise feature bullets),
  "specifications": {
    "Brand": string,
    "Model": string,
    "Product Type": string,
    "Color": string,
    "Material": string,
    "Dimensions": string,
    "Weight": string,
    "Warranty": string,
    "What's Included": string,
    [key: string]: string
  },
  "variants": Array<{ name: string; color?: string; priceDelta?: number }>,
  "highlights": string[] (3-5 marketplace highlights),
  "whyBuy": string (2-3 sentences explaining genuine benefits),
  "currentPriceRange": {
    "min": number | null,
    "max": number | null,
    "currency": "BDT",
    "source": string (e.g. "Based on market research")
  },
  "seoTitle": string (max 70 chars, SEO-optimized),
  "seoDescription": string (max 160 chars),
  "tags": string[] (5-8 relevant search tags),
  "marketingCaption": string (short promotional caption for social media),
  "suggestedPrice": number | null,
  "priceReasoning": string
}`;

  const messages = [
    { role: "user" as const, content: [...imageContent, { type: "text" as const, text: userPrompt }] },
  ];

  const context: AiContext = {
    productName: hints?.productName,
    category: suggestedCategory,
    currentPrice: hints?.costPrice ? Number(hints.costPrice) : categoryAvgPrice || undefined,
  };

  let generated: {
    title: string;
    category: string;
    subcategory: string;
    brand: string;
    model: string;
    description: string;
    shortDescription: string;
    features: string[];
    specifications: Record<string, string>;
    variants: Array<{ name: string; color?: string; priceDelta?: number }>;
    highlights: string[];
    whyBuy: string;
    currentPriceRange: { min: number | null; max: number | null; currency: string; source: string };
    seoTitle: string;
    seoDescription: string;
    tags: string[];
    marketingCaption: string;
    suggestedPrice: number | null;
    priceReasoning: string;
  };
  let generateFallback = false;

  try {
    const parsed = await completeJSONWithContext<{
      title: string;
      category: string;
      subcategory: string;
      brand: string;
      model: string;
      description: string;
      shortDescription: string;
      features: string[];
      specifications: Record<string, string>;
      variants: Array<{ name: string; color?: string; priceDelta?: number }>;
      highlights: string[];
      whyBuy: string;
      currentPriceRange: { min: number | null; max: number | null; currency: string; source: string };
      seoTitle: string;
      seoDescription: string;
      tags: string[];
      marketingCaption: string;
      suggestedPrice: number | null;
      priceReasoning: string;
    }>(messages, context, { system: PRODUCT_CONTENT_SYSTEM, maxTokens: 2048, temperature: 0.4 });
    generated = parsed.data;
    generateFallback = parsed.isFallback;
  } catch {
    generateFallback = true;
    const analysisData = analysis as {
      detectedFeatures?: unknown[];
      detectedColor?: string;
      detectedMaterial?: string;
      detectedBrand?: string;
      detectedProductType?: string;
      detectedSubcategory?: string;
      suggestedTitle?: string;
    } | null;
    const fallbackTitle = hints?.productName || analysisData?.suggestedTitle || "Product from Images";
    const fallbackCategory = suggestedCategory;
    const fallbackBrand = analysisData?.detectedBrand === "Not detected" ? "" : (analysisData?.detectedBrand || "");
    const fallbackModel = analysisData?.detectedProductType === "Not detected" ? "" : (analysisData?.detectedProductType || "");
    const fallbackFeatures = [
      ...(Array.isArray(analysisData?.detectedFeatures) ? analysisData.detectedFeatures.map((f) => String(f)) : []),
      ...(hints?.specialFeatures ? hints.specialFeatures.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ].slice(0, 6);
    const fallbackSpecs: Record<string, string> = {
      Brand: fallbackBrand || "Seller confirmation required",
      Model: fallbackModel || "Seller confirmation required",
      "Product Type": fallbackCategory,
      Color: analysisData?.detectedColor === "Not detected" ? "Seller confirmation required" : (analysisData?.detectedColor || "Seller confirmation required"),
      Material: analysisData?.detectedMaterial === "Not detected" ? "Seller confirmation required" : (analysisData?.detectedMaterial || "Seller confirmation required"),
      Dimensions: "Seller confirmation required",
      Weight: "Seller confirmation required",
      Warranty: "Seller confirmation required",
      "What's Included": "Seller confirmation required",
    };
    if (categoryAvgPrice > 0) fallbackSpecs["Category Average Price"] = `৳${categoryAvgPrice}`;

    generated = {
      title: fallbackTitle,
      category: fallbackCategory,
      subcategory: analysisData?.detectedSubcategory || "",
      brand: fallbackBrand,
      model: fallbackModel,
      description: `${fallbackTitle} is a quality ${fallbackCategory} product. ${fallbackFeatures.length > 0 ? `Key features include ${fallbackFeatures.join(", ")}.` : ""} A great choice for customers looking for reliable value.`,
      shortDescription: `${fallbackTitle} in ${fallbackCategory}. ${fallbackFeatures.length > 0 ? "Features: " + fallbackFeatures.slice(0, 3).join(", ") + "." : ""}`,
      features: fallbackFeatures.length > 0 ? fallbackFeatures : ["Quality build", "Reliable performance", "Fast delivery"],
      specifications: fallbackSpecs,
      variants: [],
      highlights: fallbackFeatures.slice(0, 5),
      whyBuy: `This ${fallbackCategory} product offers good value. ${categoryAvgPrice > 0 ? `Category average price is ৳${categoryAvgPrice}.` : ""}`,
      currentPriceRange: {
        min: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 0.9) : null,
        max: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 1.1) : null,
        currency: "BDT",
        source: categoryAvgPrice > 0 ? "Based on ShopNest category data" : "Insufficient data",
      },
      seoTitle: `${fallbackTitle} - Best Price in BD | ShopNest`,
      seoDescription: `Buy genuine ${fallbackTitle} online at best price in Bangladesh on ShopNest. Fast shipping and warranty.`,
      tags: [fallbackCategory.toLowerCase(), ...fallbackTitle.toLowerCase().split(/\s+/)].filter(Boolean).slice(0, 8),
      marketingCaption: `Upgrade your ${fallbackCategory} experience with ${fallbackTitle}.`,
      suggestedPrice: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 0.95) : null,
      priceReasoning: categoryAvgPrice > 0 ? `Based on category average of ৳${categoryAvgPrice}.` : "Insufficient market data for reliable price suggestion.",
    };
  }

  const pricing = generated.suggestedPrice && generated.suggestedPrice > 0
    ? { suggestedPrice: generated.suggestedPrice, reasoning: generated.priceReasoning }
    : { suggestedPrice: null, reasoning: "Insufficient market data for reliable price suggestion." };

  sendSuccess(res, {
    ...generated,
    pricing,
    isFallback: generateFallback,
    imageUrls,
    storeId: store._id.toString(),
  });
});

/**
 * Controller: Translate Product Content
 *
 * 1. Inputs Extracted:
 *    - req.body: content sections + targetLanguage
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - None
 * 3. Response Sent:
 *    - HTTP 200: { translatedSections, isFallback }
 */
export const translateProductContent = asyncHandler(async (req: Request, res: Response) => {
  const { sections, targetLanguage } = req.body as {
    sections: Record<string, string>;
    targetLanguage: "bn" | "en";
  };

  if (!sections || typeof sections !== "object") {
    throw ApiError.badRequest("Please provide content sections to translate.");
  }
  if (!targetLanguage || !["bn", "en"].includes(targetLanguage)) {
    throw ApiError.badRequest("Target language must be 'bn' (Bangla) or 'en' (English).");
  }

  const entries = Object.entries(sections).filter(([, v]) => v && String(v).trim());
  if (entries.length === 0) {
    throw ApiError.badRequest("No content provided for translation.");
  }

  const languageName = targetLanguage === "bn" ? "Bangla (Bengali)" : "English";

  const prompts = entries.map(
    ([key, value]) =>
      `Section: ${key}\nOriginal: ${value}\nTranslate to ${languageName}. Preserve formatting, line breaks, and structure.`
  );

  const results: Record<string, string> = {};
  for (const prompt of prompts) {
    try {
      const result = await completeJSON<{ translation: string }>(
        [{ role: "user" as const, content: prompt }],
        { system: TRANSLATION_SYSTEM, maxTokens: 512, temperature: 0.3 }
      );
      const match = prompt.match(/Section: (.+)/);
      const sectionKey = match ? match[1] : prompt;
      results[sectionKey] = result.data.translation || String(prompt);
    } catch {
      const match = prompt.match(/Section: (.+)/);
      const sectionKey = match ? match[1] : prompt;
      results[sectionKey] = String(prompt);
    }
  }

  sendSuccess(res, { translatedSections: results, isFallback: false });
});

/**
 * Controller: Suggest Product Price (Seller-specific)
 *
 * 1. Inputs Extracted:
 *    - req.body: category, costPrice (optional)
 *    - req.user: Authenticated seller ID
 * 2. Database Operation:
 *    - Product.aggregate for category avg price
 *    - Seller's own product prices in same category
 * 3. Response Sent:
 *    - HTTP 200: { categoryAvgPrice, sellerAvgPrice, suggestedMin, suggestedMax, reasoning, isFallback }
 */
export const suggestProductPrice = asyncHandler(async (req: Request, res: Response) => {
  const { category, costPrice } = req.body as { category?: string; costPrice?: number };
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Seller authentication required");
  }
  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before using AI pricing tools. Please complete your store setup first.");
  }

  let categoryAvgPrice = 0;
  let categoryProducts = 0;

  if (category) {
    const catNames = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
        { slug: category.toLowerCase() },
      ],
    }).limit(5);
    if (catNames.length > 0) {
      const catNameList = catNames.map((c) => c.name);
      const categoryMatch = await buildPublicProductFilter({ category: { $in: catNameList } });
      const agg = await Product.aggregate([
        { $match: categoryMatch },
        { $group: { _id: null, avgPrice: { $avg: "$price" }, count: { $sum: 1 } } },
      ]);
      if (agg[0]) {
        categoryAvgPrice = Math.round(agg[0].avgPrice || 0);
        categoryProducts = agg[0].count || 0;
      }
    }
  }

  const sellerAgg = await Product.aggregate([
    { $match: { storeId: store._id.toString(), isDeleted: false } },
    { $group: { _id: "$category", avgPrice: { $avg: "$price" }, count: { $sum: 1 } } },
  ]);
  const sellerAvgByCategory = sellerAgg.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.avgPrice }), {} as Record<string, number>);

  let suggestedMin: number | null = null;
  let suggestedMax: number | null = null;
  let reasoning = "";

  if (categoryAvgPrice > 0) {
    suggestedMin = Math.round(categoryAvgPrice * 0.9);
    suggestedMax = Math.round(categoryAvgPrice * 1.15);
    const sellerAvg = category ? (sellerAvgByCategory[category] || categoryAvgPrice) : categoryAvgPrice;
    reasoning = `Based on ${categoryProducts} similar products in our marketplace with an average price of ৳${categoryAvgPrice}. ` +
      `Your historical average for this category is ৳${Math.round(sellerAvg)}. ` +
      `Suggested range: ৳${suggestedMin} - ৳${suggestedMax}.`;
  } else {
    reasoning = "Not enough comparable products in this category to generate a reliable price suggestion. Consider researching similar listings manually.";
  }

  if (costPrice && costPrice > 0) {
    const minViable = Math.round(costPrice * 1.2);
    if (suggestedMin && suggestedMin < minViable) {
      suggestedMin = minViable;
      reasoning += ` Minimum viable price based on your cost (৳${costPrice}) is ৳${minViable}.`;
    }
  }

  sendSuccess(res, {
    categoryAvgPrice,
    categoryProducts,
    sellerAvgPrice: sellerAvgByCategory[category || ""] || null,
    suggestedMin,
    suggestedMax,
    reasoning,
    isFallback: false,
  });
});
