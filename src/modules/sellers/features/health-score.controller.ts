import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { getSellerContext } from "../seller-store.util";
import { Review } from "../../reviews/review.model";

type MetricScore = number | null;

// 11. SELLER HEALTH SCORE
export const getSellerHealthScore = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const {
    store,
    products,
    totalOrders,
    deliveredOrders,
    pendingOrders,
    returnedOrders,
  } = await getSellerContext(userId);

  if (!store) {
    return sendSuccess(res, {
      storeName: "My ShopNest Store",
      overallHealth: null,
      metrics: {},
      recommendations: [],
    });
  }

  const totalProducts = products.length;

  // Seller-scoped reviews: only reviews left on this seller's own products.
  const productIds = products.map((p: any) => String(p._id || p.id)).filter(Boolean);
  const reviews =
    productIds.length > 0
      ? await Review.find({ productId: { $in: productIds } }).select("rating").lean()
      : [];
  const reviewCount = reviews.length;
  const avgRating =
    reviewCount > 0
      ? reviews.reduce((sum, r: any) => sum + (Number(r.rating) || 0), 0) / reviewCount
      : 0;

  const hasOrders = totalOrders > 0;
  const hasReviews = reviewCount > 0;
  const hasCatalog = totalProducts > 0;

  // Store profile completeness — real fields only.
  const hasLogo = Boolean(store.logo);
  const hasBanner = Boolean(store.banner);
  const hasDesc = Boolean(store.description && store.description.length > 10);
  const hasBiz = Boolean(store.businessInfo?.ownerName || store.businessInfo?.contactPhone);
  const profileScore = (hasLogo ? 25 : 0) + (hasBanner ? 25 : 0) + (hasDesc ? 25 : 0) + (hasBiz ? 25 : 0);

  // Catalog readiness from the real active catalog size.
  const catalogReadiness = totalProducts >= 10 ? 100 : totalProducts >= 5 ? 80 : totalProducts >= 1 ? 50 : 0;

  // Per-pillar scores. `null` means there is no underlying data yet and the UI renders N/A.
  const customerSatisfaction: MetricScore = hasReviews ? Math.min(100, Math.round(avgRating * 20)) : null;
  const responseRate: MetricScore = null; // No customer interaction / response tracking exists yet.
  const deliveryReliability: MetricScore = hasOrders ? Math.round((deliveredOrders / totalOrders) * 100) : null;
  const returnRate: MetricScore = hasOrders ? Math.round((returnedOrders / totalOrders) * 100) : null;

  // The composite score is only calculated when the store has real activity to measure.
  let overallHealth: MetricScore = null;
  if (hasCatalog || hasOrders || hasReviews) {
    const pillars: Array<{ value: number; weight: number }> = [
      { value: catalogReadiness, weight: 0.1 },
      { value: profileScore, weight: 0.1 },
    ];
    if (customerSatisfaction !== null) pillars.push({ value: customerSatisfaction, weight: 0.25 });
    if (deliveryReliability !== null) pillars.push({ value: deliveryReliability, weight: 0.25 });
    if (returnRate !== null) pillars.push({ value: 100 - Math.min(100, returnRate * 4), weight: 0.15 });

    const weightSum = pillars.reduce((sum, p) => sum + p.weight, 0);
    const weighted = pillars.reduce((sum, p) => sum + p.value * p.weight, 0);
    overallHealth = Math.max(0, Math.min(100, Math.round(weighted / weightSum)));
  }

  const recommendations: string[] = [];

  if (totalProducts === 0) {
    recommendations.push("Upload your first product to activate your storefront and make it visible to buyers.");
  } else if (totalProducts < 5) {
    recommendations.push(`Expand your active catalog: you have ${totalProducts} product(s). Adding 5+ items significantly boosts buyer discovery.`);
  } else {
    recommendations.push(`Active product catalog is strong (${totalProducts} products listed). Keep inventory updated.`);
  }

  if (!hasLogo || !hasBanner) {
    recommendations.push("Upload a custom store logo and banner in Store Settings to establish brand identity.");
  }

  if (pendingOrders > 0) {
    recommendations.push(`You have ${pendingOrders} order(s) pending fulfillment. Dispatch promptly to boost delivery reliability.`);
  }

  if (returnedOrders > 0) {
    recommendations.push(`Recorded ${returnedOrders} return/refund case(s). Review product description accuracy and packaging.`);
  } else if (totalOrders > 0) {
    recommendations.push("Zero returns recorded! Maintain strict quality check standards.");
  }

  if (totalOrders === 0 && totalProducts > 0) {
    recommendations.push("Create promotional coupons or share your product links on social media to generate your first orders.");
  }

  sendSuccess(res, {
    storeName: store.storeName,
    overallHealth,
    metrics: {
      customerSatisfaction: {
        score: customerSatisfaction,
        unit: "%",
        target: 95,
        status: hasReviews ? (customerSatisfaction! >= 80 ? "excellent" : "good") : "unrated",
      },
      responseRate: { score: responseRate, unit: "%", target: 90, status: "insufficient_data" },
      deliveryReliability: {
        score: deliveryReliability,
        unit: "%",
        target: 95,
        status: hasOrders ? (deliveryReliability! >= 85 ? "excellent" : "good") : "pending_orders",
      },
      catalogReadiness: {
        score: catalogReadiness,
        unit: "%",
        target: 100,
        status: catalogReadiness >= 80 ? "excellent" : "good",
      },
      returnRate: {
        score: returnRate,
        unit: "%",
        target: 5,
        status: returnRate === null ? "pending_orders" : returnRate <= 5 ? "excellent" : "action_needed",
      },
    },
    recommendations: recommendations.slice(0, 4),
  });
});
