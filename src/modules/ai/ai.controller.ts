import { Request, Response } from "express";
import { Product } from "../products/product.model";
import { complete, completeJSON } from "./providers/claude.provider";
import {
  PRODUCT_DESCRIPTION_SYSTEM,
  buildDescriptionPrompt,
  COMPARE_SYSTEM,
  buildComparePrompt,
  PRICING_SYSTEM,
  buildPricingPrompt,
} from "./prompts";
import { summarizeProductReviews } from "./trust/reviewIntelligence";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logAiIncident } from "./incident/incident.service";

/** POST /ai/recommend - AI Product Recommendation Engine (query/budget/category driven). */
export const recommend = asyncHandler(async (req: Request, res: Response) => {
  const { query, budgetMax, category } = req.body as { query?: string; budgetMax?: number; category?: string };

  const filter: Record<string, unknown> = { isDeleted: false, status: "approved" };
  if (budgetMax) filter.price = { $lte: budgetMax };
  if (category) filter.category = category;
  if (query) filter.$text = { $search: query };

  const products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(10);

  sendSuccess(res, { count: products.length, products });
});

/** POST /ai/product-description - AI Product Content Generator (for sellers). */
export const productDescription = asyncHandler(async (req: Request, res: Response) => {
  const { productName, category, features } = req.body as { productName: string; category: string; features: string[] };

  try {
    const result = await completeJSON(
      [{ role: "user", content: buildDescriptionPrompt({ productName, category, features }) }],
      { system: PRODUCT_DESCRIPTION_SYSTEM }
    );
    sendSuccess(res, result);
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

/** POST /ai/review-summary - AI Review Summarization + sentiment breakdown. */
export const reviewSummary = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const result = await summarizeProductReviews(productId);
  sendSuccess(res, result);
});

/** POST /ai/compare - neutral multi-product comparison. */
export const compareProducts = asyncHandler(async (req: Request, res: Response) => {
  const { productIds } = req.body as { productIds: string[] };
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });
  if (products.length < 2) throw ApiError.badRequest("Could not find enough matching products to compare");

  const result = await completeJSON(
    [
      {
        role: "user",
        content: buildComparePrompt(
          products.map((p) => ({
            id: p.id,
            title: p.title,
            price: p.discountPrice ?? p.price,
            ratingAvg: p.ratingAvg,
            category: p.category,
            stock: p.stock,
          }))
        ),
      },
    ],
    { system: COMPARE_SYSTEM }
  );

  sendSuccess(res, result);
});

/** POST /ai/pricing - AI Pricing Assistant using internal platform data only. */
export const pricingSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  const categoryAgg = await Product.aggregate([
    { $match: { category: product.category, isDeleted: false, status: "approved" } },
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

  sendSuccess(res, { currentPrice: product.price, categoryAvgPrice, ...result });
});

/**
 * POST /ai/visual-search - describes an uploaded product image via the
 * vision-capable model, then keyword-matches the description against the
 * catalog. This is a pragmatic MVP approach; a production version would
 * use dedicated image embeddings + a vector index for real similarity search.
 */
export const visualSearch = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrl } = req.body as { imageUrl: string };

  const description = await complete([
    {
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        {
          type: "text",
          text: "In 5-8 words, describe the main product in this image for a marketplace search query (e.g. \"black wireless over-ear headphones\"). Reply with ONLY the phrase, nothing else.",
        },
      ],
    },
  ]);

  const searchTerms = description.replace(/[^a-zA-Z\s]/g, " ").trim();
  const products = await Product.find({
    isDeleted: false,
    status: "approved",
    $text: { $search: searchTerms },
  }).limit(10);

  sendSuccess(res, { detectedQuery: description, count: products.length, products });
});
