import { Request, Response } from "express";
import { OrderRisk } from "./order-risk.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

function assessRisk(order: any) {
  let score = 10;
  const factors: { name: string; description: string; weight: number }[] = [];

  if (order.totalAmount > 100000) {
    score += 30;
    factors.push({ name: "Very High Order Value", description: "Order total exceeds ৳100,000", weight: 30 });
  } else if (order.totalAmount > 50000) {
    score += 20;
    factors.push({ name: "High Order Value", description: "Order total exceeds ৳50,000", weight: 20 });
  }

  if (order.paymentMethod === "cash_on_delivery") {
    score += 15;
    factors.push({ name: "Cash on Delivery", description: "COD orders carry higher risk", weight: 15 });
  }

  if (order.paymentStatus === "unpaid" && order.status && ["delivered", "shipped"].includes(order.status)) {
    score += 20;
    factors.push({ name: "Payment Anomaly", description: "Order shipped but payment unpaid", weight: 20 });
  }

  if (order.status === "cancelled") {
    score += 15;
    factors.push({ name: "Cancelled Order", description: "Order was cancelled", weight: 15 });
  }

  if (order.status === "refunded" || order.paymentStatus === "refunded") {
    score += 20;
    factors.push({ name: "Refunded Order", description: "Order was refunded", weight: 20 });
  }

  if (order.status === "returned") {
    score += 15;
    factors.push({ name: "Returned Order", description: "Order was returned", weight: 15 });
  }

  if (order.statusHistory && order.statusHistory.length <= 1) {
    score += 10;
    factors.push({ name: "New Customer Pattern", description: "Limited order history detected", weight: 10 });
  }

  if (order.items && order.items.length > 5) {
    score += 10;
    factors.push({ name: "Bulk Quantity", description: "Large number of items in single order", weight: 10 });
  }

  score = Math.min(100, Math.max(0, score));

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (score >= 75) riskLevel = "critical";
  else if (score >= 55) riskLevel = "high";
  else if (score >= 35) riskLevel = "medium";

  return {
    orderId: order._id?.toString() || order.id,
    userId: order.userId,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    riskLevel,
    riskScore: score,
    factors,
    requiresVerification: score >= 55,
    checkedAt: new Date(),
  };
}

export const getOrderRisk = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const risk = await OrderRisk.findOne({ orderId });

  if (!risk) {
    throw ApiError.notFound("Risk assessment not found for this order");
  }

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.userId === req.user?.id;
  const isSeller = order.items.some((i) => i.sellerId === req.user?.id);
  if (!isOwner && !isSeller && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot view this risk assessment");
  }

  sendSuccess(res, risk);
});

export const assessOrderRisk = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.body as { orderId: string };

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  if (req.user?.role !== "admin") {
    throw ApiError.forbidden("Only admin can trigger risk assessment");
  }

  const riskData = assessRisk(order);

  const risk = await OrderRisk.findOneAndUpdate(
    { orderId },
    riskData,
    { new: true, upsert: true }
  );

  sendSuccess(res, risk, "Risk assessment completed");
});
