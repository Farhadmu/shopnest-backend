import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 11. SELLER HEALTH SCORE
export const getSellerHealthScore = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const {
    store,
    products,
    totalOrders,
    deliveredOrders,
    pendingOrders,
    returnedOrders,
    uniqueBuyerIds,
  } = await getSellerContext(userId);

  const totalProducts = products.length;

  // Real performance metrics
  const deliveryReliability = totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0;
  const returnRatePercent = totalOrders > 0 ? Math.round((returnedOrders / totalOrders) * 100) : 0;
  
  // Real rating or onboarding baseline
  const hasRatings = (store.ratingCount || 0) > 0 && (store.rating || 0) > 0;
  const customerSatisfaction = hasRatings ? Math.min(100, Math.round(store.rating * 20)) : 0;
  const responseRate = 95; // Benchmark standard for responsive sellers
  
  // Catalog & Store Profile completeness scores
  const catalogReadiness = totalProducts >= 10 ? 100 : totalProducts >= 5 ? 80 : totalProducts >= 1 ? 50 : 15;
  const hasLogo = Boolean(store.logo);
  const hasBanner = Boolean(store.banner);
  const hasDesc = Boolean(store.description && store.description.length > 10);
  const hasBiz = Boolean(store.businessInfo?.ownerName || store.businessInfo?.contactPhone);
  const profileScore = (hasLogo ? 25 : 0) + (hasBanner ? 25 : 0) + (hasDesc ? 25 : 0) + (hasBiz ? 25 : 0);

  // Composite Weighted Score
  let overallHealth = 0;
  if (totalOrders > 0) {
    overallHealth = Math.round(
      (hasRatings ? customerSatisfaction : 80) * 0.25 +
        responseRate * 0.15 +
        deliveryReliability * 0.25 +
        (100 - Math.min(100, returnRatePercent * 4)) * 0.15 +
        catalogReadiness * 0.10 +
        profileScore * 0.10
    );
  } else {
    // For stores with no orders yet, health index reflects store readiness & setup
    overallHealth = Math.round(catalogReadiness * 0.50 + profileScore * 0.35 + 15);
  }
  overallHealth = Math.max(10, Math.min(100, overallHealth));

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
        status: hasRatings ? (customerSatisfaction >= 80 ? "excellent" : "good") : "unrated",
      },
      responseRate: { score: responseRate, unit: "%", target: 90, status: "good" },
      deliveryReliability: {
        score: deliveryReliability,
        unit: "%",
        target: 95,
        status: totalOrders > 0 ? (deliveryReliability >= 85 ? "excellent" : "good") : "pending_orders",
      },
      catalogReadiness: { score: catalogReadiness, unit: "%", target: 100, status: catalogReadiness >= 80 ? "excellent" : "good" },
      returnRate: { score: returnRatePercent, unit: "%", target: 5, status: returnRatePercent <= 5 ? "excellent" : "action_needed" },
    },
    recommendations: recommendations.slice(0, 4),
  });
});

