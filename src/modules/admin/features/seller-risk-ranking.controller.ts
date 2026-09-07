import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Store } from "../../sellers/store.model";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { clampScore } from "@/utils/clampScore";


export const getSellerRiskRanking = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await Store.find({});
  const allOrders = await Order.find({});
  const products = await Product.find({ isDeleted: false });

  const sellerRisks = stores.map((store) => {
    const storeId = store._id?.toString() || "";
    const sellerProducts = products.filter((p) => p.storeId === storeId);
    const storeOrders = allOrders.filter((o) =>
      o.items?.some((item: any) => item.storeId === storeId)
    );

    const totalOrders = storeOrders.length;
    const cancelledOrders = storeOrders.filter((o) => o.status === "cancelled");
    const refundedOrders = storeOrders.filter((o) => o.status === "refunded" || o.status === "returned");
    const deliveredOrders = storeOrders.filter((o) => o.status === "delivered");

    const cancellationRate = totalOrders > 0 ? (cancelledOrders.length / totalOrders) * 100 : 0;
    const returnRate = totalOrders > 0 ? (refundedOrders.length / totalOrders) * 100 : 0;

    const avgRating = store.rating || 0;
    const trustScore = store.trustScore || 50;

    const rejectedProducts = sellerProducts.filter((p) => p.status === "rejected").length;
    const totalProducts = sellerProducts.length;

    const riskFactors: string[] = [];
    let riskScore = 0;

    if (cancellationRate > 20) {
      riskScore += 25;
      riskFactors.push(`High cancellation rate (${cancellationRate.toFixed(1)}%)`);
    } else if (cancellationRate > 10) {
      riskScore += 15;
      riskFactors.push(`Moderate cancellation rate (${cancellationRate.toFixed(1)}%)`);
    } else if (cancellationRate > 5) {
      riskScore += 5;
      riskFactors.push(`Low cancellation rate (${cancellationRate.toFixed(1)}%)`);
    }

    if (returnRate > 15) {
      riskScore += 20;
      riskFactors.push(`High return/refund rate (${returnRate.toFixed(1)}%)`);
    } else if (returnRate > 8) {
      riskScore += 10;
      riskFactors.push(`Moderate return/refund rate (${returnRate.toFixed(1)}%)`);
    } else if (returnRate > 3) {
      riskScore += 5;
      riskFactors.push(`Low return/refund rate (${returnRate.toFixed(1)}%)`);
    }

    if (avgRating > 0 && avgRating < 3.0) {
      riskScore += 20;
      riskFactors.push(`Low rating (${avgRating.toFixed(1)}/5)`);
    } else if (avgRating > 0 && avgRating < 3.5) {
      riskScore += 10;
      riskFactors.push(`Below average rating (${avgRating.toFixed(1)}/5)`);
    } else if (avgRating > 0 && avgRating < 4.0) {
      riskScore += 5;
      riskFactors.push(`Average rating (${avgRating.toFixed(1)}/5)`);
    }

    if (trustScore < 40) {
      riskScore += 20;
      riskFactors.push(`Low trust score (${trustScore}/100)`);
    } else if (trustScore < 60) {
      riskScore += 10;
      riskFactors.push(`Moderate trust score (${trustScore}/100)`);
    } else if (trustScore < 75) {
      riskScore += 5;
      riskFactors.push(`Trust score (${trustScore}/100)`);
    }

    if (rejectedProducts > 0) {
      riskScore += Math.min(15, rejectedProducts * 5);
      riskFactors.push(`${rejectedProducts} rejected product(s)`);
    }

    if (totalProducts === 0) {
      riskScore += 10;
      riskFactors.push("No active products");
    }

    if (totalOrders === 0) {
      riskScore += 5;
      riskFactors.push("No order history");
    }

    riskScore = clampScore(riskScore, 0, 100);

    let riskLevel: "low" | "medium" | "high" | "critical" = "low";
    if (riskScore >= 76) riskLevel = "critical";
    else if (riskScore >= 51) riskLevel = "high";
    else if (riskScore >= 26) riskLevel = "medium";

    return {
      sellerId: store.ownerId,
      storeId,
      storeName: store.storeName || "Unknown Store",
      rating: avgRating,
      trustScore,
      totalOrders,
      completedOrders: deliveredOrders.length,
      cancelledOrders: cancelledOrders.length,
      returnedOrders: refundedOrders.length,
      cancellationRate: Math.round(cancellationRate * 10) / 10,
      returnRate: Math.round(returnRate * 10) / 10,
      totalProducts,
      rejectedProducts,
      riskScore,
      riskLevel,
      riskFactors,
      status: store.status,
      lastActivity: store.updatedAt || store.createdAt,
    };
  });

  const total = sellerRisks.length;
  const lowRisk = sellerRisks.filter((s) => s.riskLevel === "low");
  const mediumRisk = sellerRisks.filter((s) => s.riskLevel === "medium");
  const highRisk = sellerRisks.filter((s) => s.riskLevel === "high");
  const criticalRisk = sellerRisks.filter((s) => s.riskLevel === "critical");
  const avgRiskScore = total > 0 ? Math.round(sellerRisks.reduce((s, r) => s + r.riskScore, 0) / total) : 0;

  const flaggedSellers = sellerRisks
    .filter((s) => s.riskLevel === "high" || s.riskLevel === "critical")
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10)
    .map((s) => ({
      sellerId: s.sellerId,
      storeId: s.storeId,
      storeName: s.storeName,
      riskScore: s.riskScore,
      riskLevel: s.riskLevel,
      reason: s.riskFactors[0] || "Multiple risk factors detected",
      actionRequired: s.riskLevel === "critical" ? "Immediate Review" : "Review Required",
    }));

  sendSuccess(res, {
    riskDistribution: {
      low: { count: lowRisk.length, percentage: total > 0 ? Math.round((lowRisk.length / total) * 100) : 0, label: "Low Risk (Verified & Good Standing)" },
      medium: { count: mediumRisk.length, percentage: total > 0 ? Math.round((mediumRisk.length / total) * 100) : 0, label: "Medium Risk" },
      high: { count: highRisk.length, percentage: total > 0 ? Math.round((highRisk.length / total) * 100) : 0, label: "High Risk" },
      critical: { count: criticalRisk.length, percentage: total > 0 ? Math.round((criticalRisk.length / total) * 100) : 0, label: "Critical" },
    },
    averageRiskScore: avgRiskScore,
    totalSellers: total,
    flaggedSellers,
    allSellers: sellerRisks.sort((a, b) => b.riskScore - a.riskScore),
  });
});

// 33. MARKETPLACE FORECASTING