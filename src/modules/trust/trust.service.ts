import { Store } from "../sellers/store.model";
import { Order } from "../orders/order.model";
import { Review } from "../reviews/review.model";
import { Product } from "../products/product.model";
import { logger } from "../../utils/logger";

export interface TrustBreakdown {
  storeId: string;
  trustScore: number;
  factors: {
    fulfillmentRate: number;
    avgRating: number;
    disputeRate: number;
    accountAgeDays: number;
  };
}

/**
 * Rule-based seller trust score (0-100). Combines order fulfillment
 * reliability, average product rating, and dispute/cancellation rate.
 * This is deliberately transparent/explainable rather than a black-box
 * model, which matters for seller-facing trust UX.
 */
export async function computeTrustBreakdown(storeId: string): Promise<TrustBreakdown | null> {
  const store = await Store.findById(storeId);
  if (!store) return null;

  const orders = await Order.find({ "items.storeId": storeId });
  const total = orders.length;
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const disputed = orders.filter((o) => ["cancelled", "returned", "refunded"].includes(o.status)).length;

  const fulfillmentRate = total > 0 ? delivered / total : 1;
  const disputeRate = total > 0 ? disputed / total : 0;

  const products = await Product.find({ storeId }).select("_id");
  const productIds = products.map((p) => p.id);
  const ratingAgg = await Review.aggregate([
    { $match: { productId: { $in: productIds } } },
    { $group: { _id: null, avg: { $avg: "$rating" } } },
  ]);
  const avgRating = ratingAgg[0]?.avg ?? 0;

  const accountAgeDays = Math.floor((Date.now() - store.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const ageFactor = Math.min(accountAgeDays / 180, 1); // maxes out at ~6 months

  const score =
    fulfillmentRate * 40 + // up to 40 points for delivering what was ordered
    (avgRating / 5) * 30 + // up to 30 points for product ratings
    (1 - disputeRate) * 20 + // up to 20 points for low disputes
    ageFactor * 10; // up to 10 points for platform tenure

  const trustScore = Math.round(Math.max(0, Math.min(100, score)));

  return {
    storeId,
    trustScore,
    factors: {
      fulfillmentRate: Math.round(fulfillmentRate * 100) / 100,
      avgRating: Math.round(avgRating * 10) / 10,
      disputeRate: Math.round(disputeRate * 100) / 100,
      accountAgeDays,
    },
  };
}

export async function recomputeStoreTrustScore(storeId: string): Promise<void> {
  try {
    const breakdown = await computeTrustBreakdown(storeId);
    if (!breakdown) return;
    await Store.findByIdAndUpdate(storeId, { trustScore: breakdown.trustScore });
  } catch (err) {
    logger.error("Failed to recompute trust score", err);
  }
}
