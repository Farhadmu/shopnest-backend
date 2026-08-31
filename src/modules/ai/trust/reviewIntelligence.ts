import { Review } from "../../reviews/review.model";
import { Product } from "../../products/product.model";
import { completeJSONWithContext, AiContext } from "../providers/claude.provider";
import { REVIEW_SUMMARY_SYSTEM, buildReviewSummaryPrompt } from "../prompts";
import { ApiError } from "../../../utils/api-error";

interface ReviewSummaryResult {
  overall: string;
  positives: string[];
  negatives: string[];
  sentiment: { positive: number; neutral: number; negative: number };
}

/** AI Review Intelligence: summarizes a product's reviews + sentiment split, and caches the sentiment on the product. */
export async function summarizeProductReviews(productId: string): Promise<ReviewSummaryResult & { isFallback: boolean }> {
  const reviews = await Review.find({ productId }).sort({ createdAt: -1 }).limit(50).select("rating comment");
  if (reviews.length === 0) {
    throw ApiError.badRequest("This product has no reviews yet");
  }

  const context: AiContext = { reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment })) };

  const result = await completeJSONWithContext<ReviewSummaryResult>(
    [{ role: "user", content: buildReviewSummaryPrompt(reviews.map((r) => ({ rating: r.rating, comment: r.comment }))) }],
    context,
    { system: REVIEW_SUMMARY_SYSTEM }
  );

  if (result.data.sentiment) {
    await Product.findByIdAndUpdate(productId, { sentiment: result.data.sentiment }).catch(() => undefined);
  }

  return { ...result.data, isFallback: result.isFallback };
}
