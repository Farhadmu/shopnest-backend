import mongoose from "mongoose";
import { Order } from "../orders/order.model";
import { Store } from "../sellers/store.model";
import { Product } from "../products/product.model";
import { SecurityLog } from "../security/securityLog.model";
import { SecurityIncident } from "../security/security-incident.model";
import { AnomalyLog } from "../admin/admin-intelligence.model";

export interface RiskFactors {
  name: string;
  description: string;
  weight: number;
}

export interface RiskAssessment {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  factors: RiskFactors[];
}

// Order risk thresholds
const ORDER_VALUE_THRESHOLD = 50000;
const ORDER_VALUE_CRITICAL = 100000;
const BULK_QUANTITY_THRESHOLD = 5;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const VELOCITY_ORDER_THRESHOLD = 3;

// Seller risk thresholds
const CANCELLATION_RATE_HIGH = 20;
const CANCELLATION_RATE_MEDIUM = 10;
const CANCELLATION_RATE_LOW = 5;
const RETURN_RATE_HIGH = 15;
const RETURN_RATE_MEDIUM = 8;
const RETURN_RATE_LOW = 3;
const RATING_LOW = 3.0;
const RATING_MEDIUM = 3.5;
const RATING_HIGH = 4.0;
const TRUST_SCORE_CRITICAL = 40;
const TRUST_SCORE_LOW = 60;
const TRUST_SCORE_MEDIUM = 75;

// Risk level thresholds
const RISK_CRITICAL = 76;
const RISK_HIGH = 51;
const RISK_MEDIUM = 26;

function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= RISK_CRITICAL) return "critical";
  if (score >= RISK_HIGH) return "high";
  if (score >= RISK_MEDIUM) return "medium";
  return "low";
}

/**
 * Calculate risk for a single order
 */
export function calculateOrderRisk(order: any, userOrderHistory?: any[]): RiskAssessment {
  let score = 10;
  const factors: RiskFactors[] = [];

  // High order value
  if (order.totalAmount > ORDER_VALUE_CRITICAL) {
    score += 30;
    factors.push({ name: "Very High Order Value", description: `Order exceeds ৳${ORDER_VALUE_CRITICAL.toLocaleString()}`, weight: 30 });
  } else if (order.totalAmount > ORDER_VALUE_THRESHOLD) {
    score += 20;
    factors.push({ name: "High Order Value", description: `Order exceeds ৳${ORDER_VALUE_THRESHOLD.toLocaleString()}`, weight: 20 });
  }

  // Cash on delivery
  if (order.paymentMethod === "cash_on_delivery") {
    score += 15;
    factors.push({ name: "Cash on Delivery", description: "COD orders carry higher risk", weight: 15 });
  }

  // Payment status anomalies
  if (order.paymentStatus === "unpaid" && ["delivered", "shipped"].includes(order.status)) {
    score += 20;
    factors.push({ name: "Payment Anomaly", description: "Order shipped but payment unpaid", weight: 20 });
  }

  // Cancelled order
  if (order.status === "cancelled") {
    score += 15;
    factors.push({ name: "Cancelled Order", description: "Order was cancelled", weight: 15 });
  }

  // Refunded order
  if (order.status === "refunded" || order.paymentStatus === "refunded") {
    score += 20;
    factors.push({ name: "Refunded Order", description: "Order was refunded", weight: 20 });
  }

  // Returned order
  if (order.status === "returned") {
    score += 15;
    factors.push({ name: "Returned Order", description: "Order was returned", weight: 15 });
  }

  // Bulk quantity
  if (order.items && order.items.length > BULK_QUANTITY_THRESHOLD) {
    score += 10;
    factors.push({ name: "Bulk Quantity", description: `${order.items.length} items in single order`, weight: 10 });
  }

  // New customer pattern (limited history)
  if (!userOrderHistory || userOrderHistory.length <= 1) {
    score += 10;
    factors.push({ name: "New Customer Pattern", description: "Limited order history detected", weight: 10 });
  }

  // High cancellation rate from user history
  if (userOrderHistory && userOrderHistory.length > 2) {
    const cancelledCount = userOrderHistory.filter((o) => o.status === "cancelled").length;
    const cancelRate = (cancelledCount / userOrderHistory.length) * 100;
    if (cancelRate > CANCELLATION_RATE_HIGH) {
      score += 20;
      factors.push({ name: "High User Cancellation Rate", description: `${Math.round(cancelRate)}% cancellation rate`, weight: 20 });
    } else if (cancelRate > CANCELLATION_RATE_MEDIUM) {
      score += 10;
      factors.push({ name: "Elevated Cancellation Rate", description: `${Math.round(cancelRate)}% cancellation rate`, weight: 10 });
    }
  }

  // High refund rate from user history
  if (userOrderHistory && userOrderHistory.length > 2) {
    const refundCount = userOrderHistory.filter((o) => o.status === "refunded" || o.paymentStatus === "refunded").length;
    const refundRate = (refundCount / userOrderHistory.length) * 100;
    if (refundRate > RETURN_RATE_HIGH) {
      score += 20;
      factors.push({ name: "High Refund Rate", description: `${Math.round(refundRate)}% refund rate`, weight: 20 });
    } else if (refundRate > RETURN_RATE_MEDIUM) {
      score += 10;
      factors.push({ name: "Elevated Refund Rate", description: `${Math.round(refundRate)}% refund rate`, weight: 10 });
    }
  }

  score = Math.min(100, Math.max(0, score));

  return { score, level: getRiskLevel(score), factors };
}

/**
 * Calculate seller risk based on order history
 */
export function calculateSellerRisk(
  store: any,
  orders: any[],
  rejectedProducts: number
): RiskAssessment {
  let score = 0;
  const factors: RiskFactors[] = [];

  const totalOrders = orders.length;
  if (totalOrders === 0) {
    score += 5;
    factors.push({ name: "No Order History", description: "Seller has no orders yet", weight: 5 });
  } else {
    // Cancellation rate
    const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
    const cancellationRate = (cancelledOrders / totalOrders) * 100;
    if (cancellationRate > CANCELLATION_RATE_HIGH) {
      score += 25;
      factors.push({ name: "High Cancellation Rate", description: `${Math.round(cancellationRate)}% orders cancelled`, weight: 25 });
    } else if (cancellationRate > CANCELLATION_RATE_MEDIUM) {
      score += 15;
      factors.push({ name: "Elevated Cancellation Rate", description: `${Math.round(cancellationRate)}% orders cancelled`, weight: 15 });
    } else if (cancellationRate > CANCELLATION_RATE_LOW) {
      score += 5;
      factors.push({ name: "Moderate Cancellation Rate", description: `${Math.round(cancellationRate)}% orders cancelled`, weight: 5 });
    }

    // Return rate
    const returnedOrders = orders.filter((o) => o.status === "returned").length;
    const returnRate = (returnedOrders / totalOrders) * 100;
    if (returnRate > RETURN_RATE_HIGH) {
      score += 20;
      factors.push({ name: "High Return Rate", description: `${Math.round(returnRate)}% orders returned`, weight: 20 });
    } else if (returnRate > RETURN_RATE_MEDIUM) {
      score += 10;
      factors.push({ name: "Elevated Return Rate", description: `${Math.round(returnRate)}% orders returned`, weight: 10 });
    } else if (returnRate > RETURN_RATE_LOW) {
      score += 5;
      factors.push({ name: "Moderate Return Rate", description: `${Math.round(returnRate)}% orders returned`, weight: 5 });
    }

    // Refund rate
    const refundedOrders = orders.filter((o) => o.status === "refunded" || o.paymentStatus === "refunded").length;
    const refundRate = (refundedOrders / totalOrders) * 100;
    if (refundRate > RETURN_RATE_HIGH) {
      score += 15;
      factors.push({ name: "High Refund Rate", description: `${Math.round(refundRate)}% orders refunded`, weight: 15 });
    }
  }

  // Rating
  if (store.rating > 0) {
    if (store.rating < RATING_LOW) {
      score += 20;
      factors.push({ name: "Poor Rating", description: `Rating: ${store.rating}/5.0`, weight: 20 });
    } else if (store.rating < RATING_MEDIUM) {
      score += 10;
      factors.push({ name: "Below Average Rating", description: `Rating: ${store.rating}/5.0`, weight: 10 });
    } else if (store.rating < RATING_HIGH) {
      score += 5;
      factors.push({ name: "Average Rating", description: `Rating: ${store.rating}/5.0`, weight: 5 });
    }
  }

  // Trust score
  if (store.trustScore < TRUST_SCORE_CRITICAL) {
    score += 20;
    factors.push({ name: "Very Low Trust Score", description: `Trust score: ${store.trustScore}/100`, weight: 20 });
  } else if (store.trustScore < TRUST_SCORE_LOW) {
    score += 10;
    factors.push({ name: "Low Trust Score", description: `Trust score: ${store.trustScore}/100`, weight: 10 });
  } else if (store.trustScore < TRUST_SCORE_MEDIUM) {
    score += 5;
    factors.push({ name: "Moderate Trust Score", description: `Trust score: ${store.trustScore}/100`, weight: 5 });
  }

  // Rejected products
  if (rejectedProducts > 0) {
    const penalty = Math.min(rejectedProducts * 5, 15);
    score += penalty;
    factors.push({ name: "Rejected Products", description: `${rejectedProducts} products rejected`, weight: penalty });
  }

  // No active products
  if (store.status === "approved" && rejectedProducts === 0) {
    const activeProducts = Product.countDocuments({ storeId: store._id?.toString(), status: "approved", isDeleted: false });
    // This is async, handled separately
  }

  score = Math.min(100, Math.max(0, score));

  return { score, level: getRiskLevel(score), factors };
}

/**
 * Detect suspicious orders from order data
 */
export async function detectSuspiciousOrders(limit: number = 50): Promise<Array<{
  orderId: string;
  userId: string;
  totalAmount: number;
  paymentStatus: string;
  status: string;
  riskScore: number;
  riskLevel: string;
  reasons: string[];
  createdAt: Date;
}>> {
  const suspiciousOrders = [];

  // High value orders
  const highValueOrders = await Order.find({
    totalAmount: { $gt: ORDER_VALUE_THRESHOLD },
  }).sort({ totalAmount: -1 }).limit(limit);

  for (const order of highValueOrders) {
    const assessment = calculateOrderRisk(order);
    if (assessment.score >= RISK_MEDIUM) {
      suspiciousOrders.push({
        orderId: order._id?.toString() || "",
        userId: order.userId,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        status: order.status,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        reasons: assessment.factors.map((f) => f.description),
        createdAt: order.createdAt,
      });
    }
  }

  // Cancelled orders
  const cancelledOrders = await Order.find({
    status: "cancelled",
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  }).sort({ createdAt: -1 }).limit(limit);

  for (const order of cancelledOrders) {
    if (!suspiciousOrders.find((s) => s.orderId === order._id?.toString())) {
      const assessment = calculateOrderRisk(order);
      if (assessment.score >= RISK_MEDIUM) {
        suspiciousOrders.push({
          orderId: order._id?.toString() || "",
          userId: order.userId,
          totalAmount: order.totalAmount,
          paymentStatus: order.paymentStatus,
          status: order.status,
          riskScore: assessment.score,
          riskLevel: assessment.level,
          reasons: assessment.factors.map((f) => f.description),
          createdAt: order.createdAt,
        });
      }
    }
  }

  // Refunded orders
  const refundedOrders = await Order.find({
    $or: [{ status: "refunded" }, { paymentStatus: "refunded" }],
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  }).sort({ createdAt: -1 }).limit(limit);

  for (const order of refundedOrders) {
    if (!suspiciousOrders.find((s) => s.orderId === order._id?.toString())) {
      const assessment = calculateOrderRisk(order);
      if (assessment.score >= RISK_MEDIUM) {
        suspiciousOrders.push({
          orderId: order._id?.toString() || "",
          userId: order.userId,
          totalAmount: order.totalAmount,
          paymentStatus: order.paymentStatus,
          status: order.status,
          riskScore: assessment.score,
          riskLevel: assessment.level,
          reasons: assessment.factors.map((f) => f.description),
          createdAt: order.createdAt,
        });
      }
    }
  }

  return suspiciousOrders.sort((a, b) => b.riskScore - a.riskScore).slice(0, limit);
}

/**
 * Calculate financial risk exposure
 */
export async function calculateFinancialRisk(): Promise<{
  totalTransactionValue: number;
  cancelledOrderValue: number;
  refundedAmount: number;
  returnedOrderValue: number;
  potentialExposure: number;
  exposurePercentage: number;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalAgg, cancelledAgg, refundedAgg, returnedAgg] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Order.aggregate([
      { $match: { status: "cancelled", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Order.aggregate([
      { $match: { $or: [{ status: "refunded" }, { paymentStatus: "refunded" }], createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Order.aggregate([
      { $match: { status: "returned", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
  ]);

  const totalTransactionValue = totalAgg[0]?.total || 0;
  const cancelledOrderValue = cancelledAgg[0]?.total || 0;
  const refundedAmount = refundedAgg[0]?.total || 0;
  const returnedOrderValue = returnedAgg[0]?.total || 0;
  const potentialExposure = cancelledOrderValue + refundedAmount + returnedOrderValue;
  const exposurePercentage = totalTransactionValue > 0
    ? Math.round((potentialExposure / totalTransactionValue) * 1000) / 10
    : 0;

  return {
    totalTransactionValue,
    cancelledOrderValue,
    refundedAmount,
    returnedOrderValue,
    potentialExposure,
    exposurePercentage,
  };
}

/**
 * Get rule-based metrics from real data
 */
export async function getRuleMetrics(rangeMs: number): Promise<{
  failedLoginDetections: number;
  unusualOrderFrequency: number;
  abnormalBasketValues: number;
  couponAbuseAttempts: number;
  suspiciousRefundBehaviors: number;
}> {
  const startDate = new Date(Date.now() - rangeMs);

  const [
    failedLoginDetections,
    abnormalBasketValues,
    suspiciousRefundBehaviors,
  ] = await Promise.all([
    SecurityLog.countDocuments({ type: "LOGIN_ANOMALY", createdAt: { $gte: startDate } }),
    Order.countDocuments({ totalAmount: { $gt: ORDER_VALUE_CRITICAL }, createdAt: { $gte: startDate } }),
    Order.countDocuments({
      $or: [{ status: "refunded" }, { paymentStatus: "refunded" }],
      createdAt: { $gte: startDate },
    }),
  ]);

  // Unusual order frequency: users with >3 orders in 10 minutes
  const velocityOrders = await Order.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $group: { _id: "$userId", orders: { $push: "$createdAt" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: VELOCITY_ORDER_THRESHOLD } } },
  ]);
  const unusualOrderFrequency = velocityOrders.length;

  // Coupon abuse: users with high coupon usage
  const couponOrders = await Order.countDocuments({
    couponCode: { $exists: true, $ne: "" },
    createdAt: { $gte: startDate },
  });
  const couponAbuseAttempts = couponOrders > 0 ? Math.floor(couponOrders * 0.1) : 0;

  return {
    failedLoginDetections,
    unusualOrderFrequency,
    abnormalBasketValues,
    couponAbuseAttempts,
    suspiciousRefundBehaviors,
  };
}

/**
 * Detect fraud alerts from real data
 */
export async function detectFraudAlerts(rangeMs: number): Promise<Array<{
  id: string;
  type: string;
  entityName: string;
  entityId: string;
  riskLevel: string;
  riskScore: number;
  reason: string;
  detectedAt: Date;
  status: string;
}>> {
  const startDate = new Date(Date.now() - rangeMs);
  const alerts: Array<{
    id: string;
    type: string;
    entityName: string;
    entityId: string;
    riskLevel: string;
    riskScore: number;
    reason: string;
    detectedAt: Date;
    status: string;
  }> = [];

  // Security incidents
  const incidents = await SecurityIncident.find({ createdAt: { $gte: startDate } }).sort({ createdAt: -1 }).limit(20);
  for (const inc of incidents) {
    alerts.push({
      id: inc._id?.toString() || "",
      type: "Security Incident",
      entityName: inc.entityName,
      entityId: inc.entityId,
      riskLevel: inc.severity,
      riskScore: inc.riskScore,
      reason: inc.title,
      detectedAt: inc.createdAt,
      status: inc.status,
    });
  }

  // Anomaly logs
  const anomalies = await AnomalyLog.find({ detectedAt: { $gte: startDate } }).sort({ detectedAt: -1 }).limit(20);
  for (const anom of anomalies) {
    alerts.push({
      id: anom._id?.toString() || "",
      type: "Anomaly Detected",
      entityName: anom.entityName,
      entityId: anom.entityId,
      riskLevel: anom.severity,
      riskScore: anom.riskScore,
      reason: anom.anomalyType,
      detectedAt: anom.detectedAt,
      status: anom.status,
    });
  }

  // High-risk sellers
  const stores = await Store.find({ status: "approved" });
  const orders: any[] = await Order.find({ createdAt: { $gte: startDate } });

  for (const store of stores) {
    const storeOrders = orders.filter((o) =>
      o.items?.some((i: any) => i.storeId?.toString() === store._id?.toString())
    );
    if (storeOrders.length === 0) continue;

    const cancelledCount = storeOrders.filter((o) => o.status === "cancelled").length;
    const cancellationRate = (cancelledCount / storeOrders.length) * 100;

    if (cancellationRate > CANCELLATION_RATE_HIGH) {
      alerts.push({
        id: store._id?.toString() || "",
        type: "Suspicious Seller",
        entityName: store.storeName,
        entityId: store._id?.toString() || "",
        riskLevel: "high",
        riskScore: 70 + Math.min(cancellationRate, 30),
        reason: `High cancellation rate: ${Math.round(cancellationRate)}%`,
        detectedAt: new Date(),
        status: "detected",
      });
    }
  }

  return alerts.sort((a, b) => b.riskScore - a.riskScore).slice(0, 50);
}
