import { Request, Response } from "express";
import { ReturnEligibility } from "./return-eligibility.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

function computeEligibility(order: any, productId: string, userId: string) {
  const deliveredAt = order.statusHistory.find((h: any) => h.status === "delivered")?.at;
  const daysSinceDelivery = deliveredAt ? Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24)) : 999;
  const returnWindowDays = 7;
  const isEligible = order.status === "delivered" && daysSinceDelivery <= returnWindowDays;

  return {
    orderId: order.id,
    productId,
    userId,
    isEligible,
    reason: isEligible
      ? "Product is within the return window"
      : daysSinceDelivery > returnWindowDays
        ? `Return window of ${returnWindowDays} days has expired (${daysSinceDelivery} days since delivery)`
        : "Order is not eligible for return",
    returnWindowDays,
    daysSinceDelivery,
    requiredEvidence: isEligible ? ["images", "description"] : [],
    refundMethod: "original_payment_method",
    estimatedProcessingDays: 5,
    checkedAt: new Date(),
  };
}

export const checkReturnEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, productId } = req.params;
  const userId = req.user?.id;

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.userId === userId;
  if (!isOwner && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot check eligibility for this order");
  }

  const result = computeEligibility(order, productId, order.userId);

  await ReturnEligibility.findOneAndUpdate(
    { orderId, productId, userId: order.userId },
    result,
    { new: true, upsert: true }
  );

  sendSuccess(res, result);
});

export const bulkCheckEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { checks } = req.body as { checks: { orderId: string; productId: string }[] };
  const userId = req.user?.id;

  const orderIds = [...new Set(checks.map((c) => c.orderId))];
  const orders = await Order.find({ _id: { $in: orderIds } });

  const ordersById = new Map(orders.map((o) => [o.id, o]));

  const results = checks.map((c) => {
    const order = ordersById.get(c.orderId);
    if (!order) {
      return { ...c, isEligible: false, reason: "Order not found" };
    }

    const isOwner = order.userId === userId;
    if (!isOwner && req.user?.role !== "admin") {
      return { ...c, isEligible: false, reason: "Not authorized" };
    }

    return computeEligibility(order, c.productId, order.userId);
  });

  sendSuccess(res, results);
});
