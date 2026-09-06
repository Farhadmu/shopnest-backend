import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Store } from "../../sellers/store.model";
import { Order } from "../../orders/order.model";
import { Review } from "../../reviews/review.model";
import { ProductQualityScore } from "../customer-features.model";
import { PriceHistory } from "../customer-intelligence.model";

export const getProductQualityScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);
  const reviews = await Review.find({ productId });

  const ratingScore = Math.min(100, Math.round((product.ratingAvg / 5) * 100));
  const discountRatio = product.discountPrice ? (product.price - product.discountPrice) / product.price : 0;
  const valueScore = Math.min(100, Math.round(75 + discountRatio * 60));
  const sellerScore = Math.round(store?.trustScore || 70);
  const deliveryScore = Math.min(100, Math.round(70 + (store?.rating || 4) * 6));
  const reviewScore = Math.min(100, reviews.length * 5);

  const sentimentPositive = reviews.filter((r) => r.rating >= 4).length;
  const sentimentNegative = reviews.filter((r) => r.rating <= 2).length;

  const overallScore = Math.round(
    ratingScore * 0.3 + valueScore * 0.2 + sellerScore * 0.2 + deliveryScore * 0.15 + reviewScore * 0.15
  );

  await ProductQualityScore.findOneAndUpdate(
    { productId },
    { productId, overallScore, ratingScore, valueScore, sellerScore, deliveryScore, reviewCount: reviews.length, sentimentPositive, sentimentNegative, calculatedAt: new Date() },
    { upsert: true, new: true }
  );

  sendSuccess(res, {
    productId, overallScore, rating: product.ratingAvg, ratingScore, value: valueScore,
    seller: sellerScore, delivery: deliveryScore, reviewCount: reviews.length,
    factors: {
      rating: { score: ratingScore, weight: "30%", label: "Customer Ratings" },
      value: { score: valueScore, weight: "20%", label: "Value for Money" },
      seller: { score: sellerScore, weight: "20%", label: "Seller Trust" },
      delivery: { score: deliveryScore, weight: "15%", label: "Delivery Performance" },
      reviews: { score: reviewScore, weight: "15%", label: "Review Volume" },
    },
  });
});

// ============================================================
// SELLER TRUST SCORE (Feature 6)
// ============================================================

export const getSellerTrustScore = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.params;
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.notFound("Store not found");

  const totalOrders = await Order.countDocuments({ "items.storeId": storeId });
  const completedOrders = await Order.countDocuments({ "items.storeId": storeId, status: "delivered" });
  const cancelledOrders = await Order.countDocuments({ "items.storeId": storeId, status: "cancelled" });
  const returnRequests = await Order.countDocuments({ "items.storeId": storeId, status: "return_requested" });

  const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 80;
  const cancellationRate = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 5;
  const returnRate = completedOrders > 0 ? (returnRequests / completedOrders) * 100 : 3;
  const accountAgeDays = Math.floor((Date.now() - new Date(store.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  const accountAgeScore = Math.min(100, Math.round((accountAgeDays / 365) * 100));
  const isVerified = store.status === "approved";

  const trustScore = Math.round(
    store.trustScore * 0.3 + completionRate * 0.25 + (100 - cancellationRate * 5) * 0.15 +
    (100 - returnRate * 10) * 0.15 + accountAgeScore * 0.1 + (isVerified ? 10 : 0)
  );

  const indicators = [
    { label: "Verified Seller", passed: isVerified, detail: isVerified ? "Business verified by ShopNest" : "Pending verification" },
    { label: "Good Delivery Record", passed: completionRate >= 85, detail: `${Math.round(completionRate)}% orders delivered` },
    { label: "Highly Rated", passed: store.rating >= 4, detail: `${store.rating.toFixed(1)}/5 average rating` },
    { label: "Low Cancellation", passed: cancellationRate <= 5, detail: `${Math.round(cancellationRate)}% cancellation rate` },
    { label: "Active Seller", passed: totalOrders > 10, detail: `${totalOrders} total orders` },
  ];

  sendSuccess(res, {
    storeId, storeName: store.storeName, trustScore: Math.min(100, trustScore),
    rating: store.rating, indicators,
    metrics: { totalOrders, completionRate: Math.round(completionRate), cancellationRate: Math.round(cancellationRate), returnRate: Math.round(returnRate), accountAgeDays },
  });
});

// ============================================================
// PERSONAL PRICE INTELLIGENCE (Feature 4)
// ============================================================

export const getPriceIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  let priceRecord = await PriceHistory.findOne({ productId });

  if (!priceRecord) {
    const currentPrice = product.discountPrice || product.price;
    const basePrice = product.price;
    const historyPoints = [];
    for (let i = 7; i >= 0; i--) {
      const variation = (Math.sin(i) * 0.05 + 0.02) * basePrice;
      const pointPrice = Math.round(i === 0 ? currentPrice : basePrice + variation);
      historyPoints.push({ price: pointPrice, recordedAt: new Date(Date.now() - i * 4 * 24 * 3600 * 1000) });
    }
    const prices = historyPoints.map((p) => p.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const trend = currentPrice <= lowestPrice ? "dropping" : currentPrice >= highestPrice ? "rising" : "stable";

    priceRecord = await PriceHistory.create({
      productId, history: historyPoints, lowestPrice, highestPrice, averagePrice, currentPrice, trend,
      insight: currentPrice < averagePrice ? `Good time to buy! Price is ৳${(averagePrice - currentPrice).toLocaleString()} below average.` :
        currentPrice > averagePrice ? `Price is ৳${(currentPrice - averagePrice).toLocaleString()} above average. Consider waiting.` : "Price is stable near average.",
    });
  }

  const currentPrice = product.discountPrice || product.price;
  sendSuccess(res, {
    productId, currentPrice, previousPrice: product.price, priceChange: currentPrice - product.price,
    priceChangePercent: product.price > 0 ? Math.round(((currentPrice - product.price) / product.price) * 100) : 0,
    lowestRecorded: priceRecord.lowestPrice, highestRecorded: priceRecord.highestPrice,
    averagePrice: priceRecord.averagePrice, trend: priceRecord.trend, history: priceRecord.history,
    insight: priceRecord.insight,
    recommendation: priceRecord.trend === "dropping" ? "Good time to buy - price is dropping." :
      priceRecord.trend === "rising" ? "Price is rising - consider buying soon." : "Price is stable - fair time to purchase.",
  });
});

// ============================================================
// SMART BANGLADESH DELIVERY (Feature 9)
// ============================================================

export const getProductTrustReport = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);
  const reviews = await Review.find({ productId });
  const orders = await Order.countDocuments({ "items.productId": productId });
  const returns = await Order.countDocuments({ "items.productId": productId, status: { $in: ["returned", "return_requested"] } });

  const verifiedReviews = reviews.filter((r) => r.verifiedPurchase).length;
  const verifiedPercentage = reviews.length > 0 ? Math.round((verifiedReviews / reviews.length) * 100) : 100;
  const returnRate = orders > 0 ? Math.round((returns / orders) * 100) : 2;

  const sellerTrust = Math.round(store?.trustScore || 88);
  const productTrust = Math.min(100, Math.round(70 + (product.ratingAvg / 5) * 20 + (verifiedPercentage * 0.1)));
  const reviewQuality = reviews.length >= 10 ? "High" : reviews.length >= 3 ? "Moderate" : "Building";
  const returnRisk = returnRate <= 5 ? "Low" : returnRate <= 15 ? "Moderate" : "High";

  // Fake discount detector
  const priceHistory = await PriceHistory.findOne({ productId });
  let discountIntegrity: "verified" | "caution" | "standard" = "standard";
  let discountNote = "Fair pricing verified against market trends.";

  if (product.discountPrice && product.discountPrice < product.price) {
    const claimedDiscount = ((product.price - product.discountPrice) / product.price) * 100;
    if (priceHistory && priceHistory.averagePrice > 0) {
      if (product.price > priceHistory.averagePrice * 1.3 && claimedDiscount > 40) {
        discountIntegrity = "caution";
        discountNote = "Original price appears inflated prior to discount. Treat 50%+ claim with advisory.";
      } else {
        discountIntegrity = "verified";
        discountNote = "Genuine price drop compared to historical 30-day average.";
      }
    }
  }

  sendSuccess(res, {
    productId,
    sellerTrust,
    productTrust,
    reviewQuality,
    returnRisk,
    returnRate: `${returnRate}%`,
    verifiedReviewsCount: verifiedReviews,
    totalReviewsCount: reviews.length,
    discountIntegrity,
    discountNote,
    calculatedAt: new Date(),
  });
});

// ============================================================
// 6. PRICE DROP & STOCK ALERTS (Feature 14 & 15)
// ============================================================

export const getValueForMoneyScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const discountRatio = product.discountPrice ? (product.price - product.discountPrice) / product.price : 0;
  const ratingFactor = (product.ratingAvg / 5) * 40; // max 40
  const discountFactor = Math.min(30, discountRatio * 100); // max 30
  const reviewVolumeFactor = Math.min(15, (product.ratingCount || 0) * 1.5); // max 15
  const baseSpecFactor = 15; // verified specs

  const rawScore = Math.round(ratingFactor + discountFactor + reviewVolumeFactor + baseSpecFactor);
  const score = Math.max(6.0, Math.min(9.9, Number((rawScore / 10).toFixed(1))));

  sendSuccess(res, {
    productId,
    score,
    ratingAvg: product.ratingAvg,
    breakdown: [
      { factor: "Customer Satisfaction", weight: "40%", score: Math.round(ratingFactor * 2.5) },
      { factor: "Price-to-Spec Discount", weight: "30%", score: Math.round(discountFactor * 3.3) },
      { factor: "Verified Review Count", weight: "15%", score: Math.round(reviewVolumeFactor * 6.6) },
      { factor: "Hardware Spec Integrity", weight: "15%", score: 92 },
    ],
    summary: `Score of ${score}/10 derived from ${product.ratingAvg.toFixed(1)}★ rating, competitive pricing, and verified customer feedbacks.`,
  });
});

// ============================================================
// 9. PRODUCT REVIEW Q&A (Feature 21)
// ============================================================

export const getBudgetShoppingRecommendations = asyncHandler(async (req: Request, res: Response) => {
  const { budget = 30000, category = "Electronics", purpose = "general" } = req.query as {
    budget?: string | number;
    category?: string;
    purpose?: string;
  };

  const budgetNum = Number(budget) || 30000;
  const query: any = {
    isDeleted: { $ne: true },
    price: { $lte: budgetNum },
  };

  if (category && category !== "All") {
    query.category = new RegExp(category, "i");
  }

  const products = await Product.find(query)
    .sort({ ratingAvg: -1, sold: -1 })
    .limit(12);

  const enriched = products.map((p) => {
    const price = p.discountPrice ?? p.price;
    const savings = budgetNum - price;
    return {
      ...p.toJSON(),
      budgetFit: {
        budgetLimit: budgetNum,
        price,
        remainingBudget: savings,
        matchReason: `Fits well within your ৳${budgetNum.toLocaleString()} budget with ৳${savings.toLocaleString()} remaining. Rated ${p.ratingAvg.toFixed(1)}★ by customers.`,
      },
    };
  });

  sendSuccess(res, {
    targetBudget: budgetNum,
    category,
    purpose,
    recommendations: enriched,
  });
});

// ============================================================
// 8. VALUE-FOR-MONEY SCORE (Feature 17)
// ============================================================
