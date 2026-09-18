import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Store } from "../../sellers/store.model";

// 8. PURCHASE DECISION SCORE
export const getPurchaseDecisionScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);

  // Require real ratings, sales, and verified store data
  const hasRating =
    typeof product.ratingAvg === "number" &&
    product.ratingAvg > 0 &&
    typeof product.ratingCount === "number" &&
    product.ratingCount > 0;
  const hasSales = typeof product.sold === "number" && product.sold > 0;

  if (!hasRating || !hasSales || !store) {
    return sendSuccess(res, {
      productId,
      insufficientData: true,
      reason: "Insufficient rating, sales, or seller verification data to calculate AI decision score",
    });
  }

  // 1. Value (Discount ratio & competitive pricing)
  const discountRatio =
    product.discountPrice && product.discountPrice < product.price
      ? (product.price - product.discountPrice) / product.price
      : 0;
  const valueScore = Math.min(98, Math.max(60, Math.round(75 + discountRatio * 75)));
  const valueNote =
    discountRatio > 0
      ? `${Math.round(discountRatio * 100)}% discount advantage`
      : "Competitive standard retail price";

  // 2. Quality (Rating average & verified reviews count)
  const ratingAvg = product.ratingAvg;
  const sentimentBonus =
    product.sentiment?.positive && product.sentiment.positive > 0
      ? Math.min(5, Math.round(product.sentiment.positive))
      : 0;
  const qualityScore = Math.min(99, Math.max(50, Math.round((ratingAvg / 5) * 90 + sentimentBonus)));
  const qualityNote = `${ratingAvg.toFixed(1)}/5 rating (${product.ratingCount} review${
    product.ratingCount === 1 ? "" : "s"
  })`;

  // 3. Popularity (Real sold count)
  const sold = product.sold;
  const popularityScore = Math.min(98, Math.max(50, Math.round(60 + Math.log10(sold + 1) * 18)));
  const popularityNote = `${sold} unit${sold === 1 ? "" : "s"} ordered recently`;

  // 4. Reliability (Real seller trust & stock stability)
  const sellerTrust = typeof store.trustScore === "number" ? store.trustScore : 60;
  const inStockBonus = product.stock > 5 ? 5 : 0;
  const reliabilityScore = Math.min(98, Math.max(50, Math.round(sellerTrust * 0.9 + inStockBonus)));
  const reliabilityNote = `${store.storeName} (${sellerTrust}% trust index)`;

  // Overall Weighted Score
  const overallScore = Math.round(
    valueScore * 0.35 + qualityScore * 0.30 + popularityScore * 0.15 + reliabilityScore * 0.20
  );

  const recommendation =
    overallScore >= 85
      ? "Exceptional Buy · Top verified ratings and seller reliability"
      : overallScore >= 75
      ? "Strong Buy · Solid performance within its category"
      : "Solid Option · Fair value within its price tier";

  sendSuccess(res, {
    productId,
    overallScore,
    dimensions: {
      value: { score: valueScore, label: "Price / Value", note: valueNote },
      quality: { score: qualityScore, label: "Verified Quality", note: qualityNote },
      popularity: { score: popularityScore, label: "Market Popularity", note: popularityNote },
      reliability: { score: reliabilityScore, label: "Seller Reliability", note: reliabilityNote },
    },
    recommendation,
    insufficientData: false,
  });
});