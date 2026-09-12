import { Request, Response } from "express";
import { Product } from "../products/product.model";
import { Category } from "../categories/category.model";
import { completeJSONWithContext, AiContext } from "./providers/gemini.provider";
import { logger } from "../../utils/logger";
import {
  PRODUCT_ANALYSIS_SYSTEM,
  PRODUCT_CONTENT_SYSTEM,
  buildDescriptionPrompt,
} from "./prompts";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { getSellerStore } from "../sellers/seller-store.util";
import {
  checkImageQuality,
  searchWeb,
  discoverProductImages,
  generateProductImage,
  type ProductResearchResult,
  type ProductSource,
  type PriceObservation,
} from "./product-finder.service";

const VISION_MODELS = new Set([
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
]);

function isVisionModel(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes("claude-2") || lower.includes("claude-instant")) return false;
  if (lower.includes("claude-3") || lower.includes("claude-sonnet-4") || lower.includes("claude-4") || lower.includes("claude-opus-4")) return true;
  return VISION_MODELS.has(lower);
}

function buildProgress(steps: Array<{ step: string; message: string; status: "pending" | "running" | "completed" | "failed" | "skipped"; error?: string }>) {
  return steps.map((s, idx) => ({
    step: s.step as ProductResearchResult["progress"][number]["step"],
    status: s.status,
    message: s.message,
    startedAt: idx === 0 ? new Date().toISOString() : undefined,
    completedAt: s.status === "completed" || s.status === "failed" || s.status === "skipped" ? new Date().toISOString() : undefined,
    error: s.error,
  }));
}

export const runProductFinder = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrls, hints } = req.body as {
    imageUrls: string[];
    hints?: Record<string, string>;
  };

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw ApiError.badRequest("Please upload at least one product image.");
  }

  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Seller authentication required");
  }

  const progress: ProductResearchResult["progress"] = [];
  const limitations: string[] = [];
  const sources: ProductSource[] = [];
  const discoveredImages: ProductResearchResult["discoveredImages"] = [];
  const generatedImages: string[] = [];

  // Step 1: Image quality check
  progress.push({ step: "image_quality", status: "running", message: "Checking image quality...", startedAt: new Date().toISOString() });
  const qualityChecks = await Promise.all(imageUrls.map((url) => checkImageQuality(url)));
  const badImages = qualityChecks.filter((q) => !q.usable);
  if (badImages.length > 0) {
    progress[progress.length - 1].status = "failed";
    progress[progress.length - 1].completedAt = new Date().toISOString();
    progress[progress.length - 1].error = badImages.map((q) => q.reason).join("; ");
    return sendSuccess(res, {
      productFound: false,
      confidence: "none",
      progress,
      limitations: ["One or more images failed quality check"],
      identifiedProduct: null,
      sources: [],
      verificationStatus: {},
      priceResearch: null,
      discoveredImages: [],
      generatedImages: [],
      content: null,
    } as Partial<ProductResearchResult>);
  }
  progress[progress.length - 1].status = "completed";
  progress[progress.length - 1].completedAt = new Date().toISOString();

  // Step 2: Vision analysis
  progress.push({ step: "vision_analysis", status: "running", message: "Analyzing product images with AI vision...", startedAt: new Date().toISOString() });

  const imageContent = imageUrls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const visionPrompt = `Analyze these ${imageUrls.length} product image(s) carefully.

${hints?.productName ? `Seller hint: ${hints.productName}` : ""}
${hints?.notes ? `Seller notes: ${hints.notes}` : ""}

Identify the product with maximum detail:
- Exact product name if readable
- Brand (from logo, text, or design language)
- Model number/series if visible
- Product type/category
- Color, material, design
- Any visible text, labels, barcodes
- Packaging information
- Condition

Return ONLY valid JSON:
{
  "identifiedProductType": string,
  "identifiedBrand": string,
  "identifiedModel": string,
  "identifiedCategory": string,
  "identifiedSubcategory": string,
  "identifiedColor": string,
  "identifiedMaterial": string,
  "identifiedVariant": string,
  "visibleFeatures": string[],
  "visibleText": string[],
  "conditionNotes": string,
  "identificationConfidence": "high" | "medium" | "low",
  "requiresConfirmation": boolean
}`;

  let visionResult: {
    identifiedProductType: string;
    identifiedBrand: string;
    identifiedModel: string;
    identifiedCategory: string;
    identifiedSubcategory: string;
    identifiedColor: string;
    identifiedMaterial: string;
    identifiedVariant: string;
    visibleFeatures: string[];
    visibleText: string[];
    conditionNotes: string;
    identificationConfidence: "high" | "medium" | "low";
    requiresConfirmation: boolean;
  };

  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const supportsVision = isVisionModel(model);

    if (!supportsVision) {
      throw new Error(`Model ${model} does not support vision`);
    }

    const parsed = await completeJSONWithContext<typeof visionResult>(
      [{ role: "user" as const, content: [...imageContent, { type: "text" as const, text: visionPrompt }] }],
      { productName: hints?.productName, category: hints?.category },
      { system: PRODUCT_ANALYSIS_SYSTEM, maxTokens: 1024, temperature: 0.2 }
    );
    visionResult = parsed.data;
    progress[progress.length - 1].status = "completed";
    progress[progress.length - 1].completedAt = new Date().toISOString();
  } catch {
    progress[progress.length - 1].status = "failed";
    progress[progress.length - 1].completedAt = new Date().toISOString();
    progress[progress.length - 1].error = "Vision analysis failed. Please try again with clearer images.";
    return sendSuccess(res, {
      productFound: false,
      confidence: "none",
      progress,
      limitations: ["AI vision analysis unavailable"],
      identifiedProduct: null,
      sources: [],
      verificationStatus: {},
      priceResearch: null,
      discoveredImages: [],
      generatedImages: [],
      content: null,
    } as Partial<ProductResearchResult>);
  }

  const productName = visionResult.identifiedModel || visionResult.identifiedProductType || hints?.productName || "Unidentified Product";

  // Step 3: Web research
  progress.push({ step: "web_research", status: "running", message: "Searching online for product information...", startedAt: new Date().toISOString() });
  const searchQueries = [
    `${visionResult.identifiedBrand} ${productName} specifications`,
    `${productName} price Bangladesh`,
    `${productName} review features`,
  ];

  const searchResults: ProductSource[] = [];
  for (const query of searchQueries) {
    const result = await searchWeb(query);
    if (result.status === "success") {
      searchResults.push(...result.results);
    } else if (result.status === "failed") {
      progress[progress.length - 1].error = result.error;
    }
  }

  if (searchResults.length === 0) {
    limitations.push("Online research unavailable. No search provider configured or search returned no results.");
    progress[progress.length - 1].status = "skipped";
  } else {
    progress[progress.length - 1].status = "completed";
  }
  progress[progress.length - 1].completedAt = new Date().toISOString();
  sources.push(...searchResults.slice(0, 10));

  // Step 4: Source verification
  progress.push({ step: "source_verification", status: "running", message: "Verifying product information from sources...", startedAt: new Date().toISOString() });
  const verificationStatus: Record<string, "verified" | "partially_verified" | "not_verified" | "conflicting"> = {
    brand: sources.length > 0 ? "partially_verified" : "not_verified",
    model: sources.length > 0 ? "partially_verified" : "not_verified",
    price: sources.length > 0 ? "partially_verified" : "not_verified",
    specifications: sources.length > 0 ? "not_verified" : "not_verified",
    features: sources.length > 0 ? "not_verified" : "not_verified",
  };
  progress[progress.length - 1].status = sources.length > 0 ? "completed" : "skipped";
  progress[progress.length - 1].completedAt = new Date().toISOString();

  // Step 5: Price research
  progress.push({ step: "price_research", status: "running", message: "Researching current market prices...", startedAt: new Date().toISOString() });
  const priceSearch = await searchWeb(`${productName} price BD`);
  const observedPrices: PriceObservation[] = [];

  if (priceSearch.status === "success") {
    for (const source of priceSearch.results.slice(0, 5)) {
      const priceMatch = source.snippet.match(/৳\s?([\d,]+)/);
      if (priceMatch) {
        observedPrices.push({
          amount: Number(priceMatch[1].replace(/,/g, "")),
          currency: "BDT",
          source: source.title,
          sourceUrl: source.url,
          observedAt: new Date().toISOString(),
          isVerified: source.type === "retailer" || source.type === "official",
        });
      }
    }
  }

  let suggestedPrice: number | null = null;
  let priceRangeMin: number | null = null;
  let priceRangeMax: number | null = null;
  let priceReasoning = "Insufficient verified pricing data.";

  if (observedPrices.length > 0) {
    const amounts = observedPrices.map((p: PriceObservation) => p.amount);
    priceRangeMin = Math.min(...amounts);
    priceRangeMax = Math.max(...amounts);
    suggestedPrice = Math.round((priceRangeMin + priceRangeMax) / 2);
    priceReasoning = `Based on ${observedPrices.length} price observations from online sources. Range: ৳${priceRangeMin} - ৳${priceRangeMax}.`;
    verificationStatus.price = "partially_verified";
  } else if (sources.length > 0) {
    priceReasoning = "Price information not found in search results. Please verify manually.";
    verificationStatus.price = "not_verified";
  }

  progress[progress.length - 1].status = observedPrices.length > 0 ? "completed" : sources.length > 0 ? "completed" : "skipped";
  progress[progress.length - 1].completedAt = new Date().toISOString();

  // Step 6: Image discovery
  progress.push({ step: "image_discovery", status: "running", message: "Finding product images online...", startedAt: new Date().toISOString() });
  const imageDiscovery = await discoverProductImages(productName, visionResult.identifiedBrand);
  if (imageDiscovery.status === "success") {
    discoveredImages.push(...imageDiscovery.images.slice(0, 6));
    progress[progress.length - 1].status = "completed";
  } else {
    limitations.push(imageDiscovery.error || "Online image discovery unavailable.");
    progress[progress.length - 1].status = "skipped";
  }
  progress[progress.length - 1].completedAt = new Date().toISOString();

  // Step 7: AI image generation
  progress.push({ step: "image_generation", status: "running", message: "Generating product image...", startedAt: new Date().toISOString() });
  const imageGenResult = await generateProductImage(productName, imageUrls);
  if (imageGenResult.status === "success" && imageGenResult.imageUrl) {
    generatedImages.push(imageGenResult.imageUrl);
    progress[progress.length - 1].status = "completed";
  } else {
    limitations.push(imageGenResult.error || "AI image generation unavailable.");
    progress[progress.length - 1].status = "skipped";
  }
  progress[progress.length - 1].completedAt = new Date().toISOString();

  // Step 8: Generate listing content
  progress.push({ step: "listing_generation", status: "running", message: "Preparing product listing...", startedAt: new Date().toISOString() });

  const context: AiContext = {
    productName: productName,
    category: visionResult.identifiedCategory || hints?.category,
    currentPrice: suggestedPrice || undefined,
  };

  const listingPrompt = `Generate a complete marketplace product listing for:

Product: ${productName}
Brand: ${visionResult.identifiedBrand}
Model: ${visionResult.identifiedModel}
Category: ${visionResult.identifiedCategory}
Subcategory: ${visionResult.identifiedSubcategory}
Color: ${visionResult.identifiedColor}
Material: ${visionResult.identifiedMaterial}
Variant: ${visionResult.identifiedVariant}
Visible Features: ${visionResult.visibleFeatures.join(", ")}

Price Context:
      ${observedPrices.length > 0 ? `Observed prices: ${observedPrices.map((p: PriceObservation) => `৳${p.amount} from ${p.source}`).join("; ")}` : "No verified price data available."}
${suggestedPrice ? `Suggested price: ৳${suggestedPrice}` : ""}

${hints?.productName ? `Seller provided name: ${hints.productName}` : ""}
${hints?.targetCustomer ? `Target customer: ${hints.targetCustomer}` : ""}
${hints?.specialFeatures ? `Special features: ${hints.specialFeatures}` : ""}

IMPORTANT:
- Use ONLY information provided above and your training knowledge
- If search results were provided, prioritize them
- Mark uncertain fields with "Seller confirmation required"
- Do NOT invent specifications not supported by the data
- Generate accurate, detailed, marketplace-ready content

Return ONLY valid JSON:
{
  "title": string (professional marketplace title, max 120 chars),
  "category": string,
  "subcategory": string,
  "brand": string,
  "model": string,
  "description": string (detailed long description with sections: Product Overview, Key Features, Detailed Specifications, Benefits, Use Cases, Package Contents, Warranty, Why Choose This Product),
  "shortDescription": string (max 200 chars),
  "features": string[] (4-6 concise feature bullets),
  "specifications": { [key: string]: string } (dynamically relevant to product type),
  "variants": Array<{ name: string; color?: string; priceDelta?: number }>,
  "highlights": string[] (3-5 marketplace highlights),
  "whyBuy": string (2-3 sentences),
  "seoTitle": string (max 70 chars),
  "seoDescription": string (max 160 chars),
  "tags": string[] (5-8 relevant search tags),
  "marketingCaption": string (short promotional caption),
  "packageContents": string[],
  "warranty": string,
  "suggestedPrice": number | null,
  "priceReasoning": string
}`;

  let listingContent: ProductResearchResult["content"] | null = null;
  let listingFallback = false;

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
      seoTitle: string;
      seoDescription: string;
      tags: string[];
      marketingCaption: string;
      packageContents: string[];
      warranty: string;
      suggestedPrice: number | null;
      priceReasoning: string;
    }>([{ role: "user" as const, content: listingPrompt }], context, {
      system: PRODUCT_CONTENT_SYSTEM,
      maxTokens: 2048,
      temperature: 0.4,
    });

    listingContent = parsed.data;
    listingFallback = parsed.isFallback;
  } catch (error) {
    limitations.push("Product listing generation failed. Please try again or add the product manually.");
    progress[progress.length - 1].status = "failed";
    progress[progress.length - 1].error = error instanceof Error ? error.message : "Listing generation failed";
  }

  progress[progress.length - 1].completedAt = new Date().toISOString();

  const identifiedProduct = {
    name: productName,
    brand: visionResult.identifiedBrand,
    model: visionResult.identifiedModel,
    category: visionResult.identifiedCategory,
    subcategory: visionResult.identifiedSubcategory,
    productType: visionResult.identifiedProductType,
    color: visionResult.identifiedColor,
    material: visionResult.identifiedMaterial,
    variant: visionResult.identifiedVariant,
  };

  const result: ProductResearchResult = {
    productFound: true,
    confidence: visionResult.identificationConfidence,
    identifiedProduct,
    sources,
    verificationStatus,
    priceResearch: {
      observedPrices,
      suggestedPrice,
      priceRange: { min: priceRangeMin, max: priceRangeMax },
      currency: "BDT",
      reasoning: priceReasoning,
      researchStatus: observedPrices.length > 0 ? "partially_verified" : "not_verified",
    },
    discoveredImages,
    generatedImages,
    content: listingContent,
    limitations,
    progress,
  };

  sendSuccess(res, result);
});
