import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { ReturnRequest } from "../customer-features.model";

export const getReturnRequests = asyncHandler(async (req: Request, res: Response) => {
  const returns = await ReturnRequest.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, returns);
});

export const createReturnRequest = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId, productId, type, reason, evidenceUrls } = req.body;

  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");
  const orderItem = order.items.find((i) => i.productId === productId);
  if (!orderItem) throw ApiError.badRequest("Product not found in this order");

  const existing = await ReturnRequest.findOne({ userId, orderId, productId, status: { $ne: "rejected" } });
  if (existing) throw ApiError.conflict("Return request already exists for this product");

  const returnReq = await ReturnRequest.create({
    userId, orderId, productId, productTitle: orderItem.title, sellerId: orderItem.sellerId,
    type, reason, status: "requested",
    statusHistory: [{ status: "requested", at: new Date(), note: "Return requested by customer" }],
    evidenceUrls: evidenceUrls || [], refundAmount: orderItem.price * orderItem.quantity,
    refundMethod: order.paymentMethod === "cash_on_delivery" ? "bank_transfer" : order.paymentMethod,
  });

  order.status = "returned";
  await order.save();
  sendSuccess(res, returnReq, "Return request submitted successfully", 201);
});

export const getReturnDetails = asyncHandler(async (req: Request, res: Response) => {
  const returnReq = await ReturnRequest.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!returnReq) throw ApiError.notFound("Return request not found");
  sendSuccess(res, returnReq);
});

// ============================================================
// SMART PAYMENT CENTER (Feature 12)
// ============================================================

export const getReturnEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const now = new Date();
  const deliveryDate = (order as any).deliveredAt ? new Date((order as any).deliveredAt) : new Date(order.updatedAt);
  const daysSinceDelivery = Math.floor((now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
  const returnWindowDays = 7;
  const isWithinWindow = daysSinceDelivery <= returnWindowDays && order.status === "delivered";

  sendSuccess(res, {
    orderId,
    orderStatus: order.status,
    isEligible: isWithinWindow,
    daysRemaining: Math.max(0, returnWindowDays - daysSinceDelivery),
    returnWindow: `${returnWindowDays} Days Return Policy`,
    requiredEvidence: [
      "Original unboxing photo / video",
      "Item in undamaged condition with all tags and accessories",
      "Packaging box with courier shipping label intact",
    ],
    refundMethods: ["Original Payment Method (bKash / Card / Nagad)", "ShopNest Wallet Balance"],
    expectedProcessingDays: "3-5 Business Days",
  });
});
