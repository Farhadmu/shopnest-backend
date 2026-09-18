import { Types, startSession } from "mongoose";
import crypto from "crypto";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Order } from "../../orders/order.model";
import { Product } from "../../products/product.model";
import { ReturnRequest, Refund, ReverseDeliveryRequest, PaymentRecord, type IReturnRequest, type IRefund, type IReverseDeliveryRequest } from "../customer-features.model";
import { createNotification, createAdminNotification } from "../../../modules/notifications/notification.service";
import { AuditLog, type IAuditLog } from "../../../modules/security/auditLog.model";
import { emitDeliveryEvent, emitAdminOperationsEvent } from "../../../realtime/socket.server";
import stripe from "../../../config/stripe";
import { normalizeLean } from "../../../utils/model-plugins";

const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["under_review", "approved", "rejected", "cancelled"],
  under_review: ["approved", "rejected", "cancelled"],
  approved: ["reverse_available", "cancelled"],
  rejected: [],
  reverse_available: ["reverse_assigned", "cancelled"],
  reverse_assigned: ["reverse_accepted", "pickup_started", "cancelled", "failed"],
  reverse_accepted: ["pickup_started", "cancelled", "failed"],
  pickup_started: ["picked_up", "cancelled", "failed"],
  picked_up: ["in_transit", "failed"],
  in_transit: ["seller_received", "failed"],
  seller_received: ["inspection_pending", "failed"],
  inspection_pending: ["inspection_approved", "inspection_rejected", "failed"],
  inspection_approved: ["refund_pending", "refund_processing", "refunded", "failed"],
  inspection_rejected: ["refund_failed", "cancelled", "failed"],
  refund_pending: ["refund_processing", "refund_failed", "cancelled"],
  refund_processing: ["refunded", "refund_failed"],
  refunded: [],
  refund_failed: ["refund_pending", "cancelled"],
  cancelled: [],
  failed: ["reverse_available", "cancelled"],
};

function appendStatus(returnReq: any, status: string, note?: string) {
  returnReq.statusHistory.push({ status, at: new Date(), note });
}

function assertTransition(current: string, next: string) {
  if (current === next) return;
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw ApiError.badRequest(`Cannot transition return from ${current} to ${next}`);
  }
}

export async function getCustomerReturns(userId: string) {
  const returns = await ReturnRequest.find({ userId }).sort({ createdAt: -1 }).lean();
  return returns.map(normalizeLean);
}

export async function getReturnById(id: string, actorId: string, role: string) {
  const where = role === "customer" ? { _id: id, userId: actorId } : { _id: id };
  const returnReq = await ReturnRequest.findOne(where).lean();
  if (!returnReq) throw ApiError.notFound("Return request not found");
  return normalizeLean(returnReq);
}

export async function getReturnEligibility(orderId: string, productId: string, userId?: string) {
  const order = await Order.findOne({ _id: orderId });
  if (!order) throw ApiError.notFound("Order not found");
  if (userId && order.userId !== userId) throw ApiError.forbidden("You are not authorized to view this order");

  const now = new Date();
  const deliveryDate = order.deliveredAt ? new Date(order.deliveredAt) : new Date(order.updatedAt);
  const daysSinceDelivery = Math.floor((now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
  const returnWindowDays = 7;
  const isWithinWindow = daysSinceDelivery <= returnWindowDays && order.status === "delivered";

  const orderItem = order.items.find((i) => String(i.productId) === String(productId));
  if (!orderItem) throw ApiError.badRequest("Product not found in this order");

  const existing = await ReturnRequest.findOne({ orderId, productId, status: { $ne: "rejected" } });
  const alreadyRequested = Boolean(existing);

  return {
    orderId,
    orderIdShort: String(orderId).slice(-8).toUpperCase(),
    productTitle: orderItem.title,
    productImage: orderItem.image || null,
    unitPrice: orderItem.price,
    orderedQuantity: orderItem.quantity,
    sellerId: orderItem.sellerId,
    orderStatus: order.status,
    orderDeliveredAt: order.deliveredAt,
    isDelivered: order.status === "delivered",
    isEligible: isWithinWindow && !alreadyRequested,
    daysRemaining: Math.max(0, returnWindowDays - daysSinceDelivery),
    returnWindow: `${returnWindowDays} Days Return Policy`,
    reason: existingAlreadyRequestedReason(existing),
    requiredEvidence: [
      "Original unboxing photo / video",
      "Item in undamaged condition with all tags and accessories",
      "Packaging box with courier shipping label intact",
    ],
    refundMethods: ["Original Payment Method", "ShopNest Wallet Balance"],
    expectedProcessingDays: "3-5 Business Days",
    maxEvidenceImages: 5,
  };
}

function existingAlreadyRequestedReason(existing: any): string | undefined {
  if (!existing) return undefined;
  if (existing.status === "refunded" || existing.status === "cancelled") return "Return already processed";
  return `Return already in progress (status: ${existing.status})`;
}

export async function createReturnRequest(userId: string, input: {
  orderId: string;
  orderItemId: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  sellerId: string;
  sellerName?: string;
  type: "return" | "refund" | "replacement";
  reason: string;
  description: string;
  quantity: number;
  evidenceUrls: string[];
  pickupAddress: string;
  sellerReturnAddress: string;
}) {
  const order = await Order.findOne({ _id: input.orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status !== "delivered") throw ApiError.badRequest("Only delivered orders are eligible for return");

  const orderItem = order.items.find((i) => String(i.productId) === String(input.productId));
  if (!orderItem) throw ApiError.badRequest("Product not found in this order");

  // Verify seller owns this order item
  if (String(orderItem.sellerId) !== String(input.sellerId)) {
    throw ApiError.forbidden("Seller ID does not match the order item");
  }

  if (input.quantity > orderItem.quantity) throw ApiError.badRequest("Requested quantity exceeds ordered quantity");
  if (input.quantity < 1) throw ApiError.badRequest("Quantity must be at least 1");

  const existing = await ReturnRequest.findOne({ orderId: input.orderId, productId: input.productId, status: { $ne: "rejected" } });
  if (existing) throw ApiError.conflict("Return request already exists for this product");

  // Validate reason
  const validReasons = [
    "Damaged Product", "Wrong Product", "Defective Product",
    "Missing Parts", "Not as Described", "Wrong Size",
    "Quality Issue", "Other",
  ];
  if (!validReasons.includes(input.reason)) {
    throw ApiError.badRequest("Invalid return reason");
  }

  // Validate description length
  if (input.description && input.description.length > 500) {
    throw ApiError.badRequest("Description must not exceed 500 characters");
  }

  // Validate evidence images
  if (input.evidenceUrls && input.evidenceUrls.length > 5) {
    throw ApiError.badRequest("Maximum 5 evidence images allowed");
  }

  const requestedRefundAmount = Number((orderItem.price * input.quantity).toFixed(2));
  const now = new Date();
  const returnReq = await ReturnRequest.create({
    userId,
    orderId: input.orderId,
    orderItemId: input.orderItemId || input.productId,
    productId: input.productId,
    productTitle: input.productTitle,
    productImage: input.productImage || orderItem.image,
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    type: input.type,
    reason: input.reason,
    description: input.description,
    quantity: input.quantity,
    status: "requested",
    statusHistory: [{ status: "requested", at: now, note: "Return requested by customer" }],
    evidenceUrls: input.evidenceUrls || [],
    pickupAddress: input.pickupAddress,
    sellerReturnAddress: input.sellerReturnAddress,
    requestedRefundAmount,
    calculatedRefundAmount: requestedRefundAmount,
    refundMethod: order.paymentMethod === "cash_on_delivery" ? "bank_transfer" : order.paymentMethod,
  });

  await AuditLog.create({
    actorId: userId,
    actorName: "Customer",
    role: "customer",
    action: "RETURN_CREATED",
    resource: "ReturnRequest",
    resourceId: String(returnReq._id),
    status: "success",
    details: { orderId: input.orderId, productId: input.productId, type: input.type },
  });

  await createNotification({
    userId: input.sellerId,
    recipientType: "seller",
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "order",
    title: "New Return Request",
    message: `A return request has been submitted for order #${String(input.orderId).slice(-8).toUpperCase()}.`,
    link: `/dashboard/seller/orders`,
    relatedId: input.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  await createAdminNotification({
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "order",
    title: "New Return Request",
    message: `Return request created for order #${String(input.orderId).slice(-8).toUpperCase()} - ${input.reason}.`,
    link: `/dashboard/admin/returns`,
    relatedId: String(returnReq._id),
    relatedType: "order",
  }).catch(() => undefined);

  return returnReq;
}

export async function approveReturn(returnId: string, actorId: string, actorName: string, note?: string) {
  const returnReq = await ReturnRequest.findById(returnId);
  if (!returnReq) throw ApiError.notFound("Return request not found");

  // Verify seller owns this return
  if (returnReq.sellerId !== actorId) {
    throw ApiError.forbidden("You can only approve returns for your own products");
  }

  assertTransition(returnReq.status, "approved");
  const now = new Date();
  returnReq.status = "approved";
  returnReq.approvedAt = now;
  appendStatus(returnReq, "approved", note || "Return approved");
  await returnReq.save();

  await AuditLog.create({
    actorId,
    actorName,
    role: "seller",
    action: "RETURN_APPROVED",
    resource: "ReturnRequest",
    resourceId: returnId,
    status: "success",
    details: { orderId: returnReq.orderId, productId: returnReq.productId },
  });

  const reverse = await createReverseDelivery(returnReq);
  returnReq.deliveryRequestId = String(reverse._id);
  await returnReq.save();

  await createNotification({
    userId: returnReq.userId,
    recipientType: "user",
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "order",
    title: "Return Approved",
    message: `Your return for order #${String(returnReq.orderId).slice(-8).toUpperCase()} has been approved. A delivery partner will pick up the item.`,
    link: `/dashboard/user/orders`,
    relatedId: returnReq.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  emitAdminOperationsEvent("admin:reverse_delivery_created", {
    returnRequestId: returnId,
    reverseDeliveryId: String(reverse._id),
    orderId: returnReq.orderId,
    customerId: returnReq.userId,
    sellerId: returnReq.sellerId,
  });

  return { returnReq, reverse };
}

export async function rejectReturn(returnId: string, actorId: string, actorName: string, rejectionReason: string) {
  const returnReq = await ReturnRequest.findById(returnId);
  if (!returnReq) throw ApiError.notFound("Return request not found");

  // Verify seller owns this return
  if (returnReq.sellerId !== actorId) {
    throw ApiError.forbidden("You can only reject returns for your own products");
  }

  if (!rejectionReason || !rejectionReason.trim()) throw ApiError.badRequest("Rejection reason is required");

  assertTransition(returnReq.status, "rejected");
  returnReq.status = "rejected";
  returnReq.rejectedAt = new Date();
  returnReq.rejectionReason = rejectionReason.trim();
  appendStatus(returnReq, "rejected", rejectionReason.trim());
  await returnReq.save();

  await AuditLog.create({
    actorId,
    actorName,
    role: "seller",
    action: "RETURN_REJECTED",
    resource: "ReturnRequest",
    resourceId: returnId,
    status: "success",
    details: { orderId: returnReq.orderId, productId: returnReq.productId, rejectionReason },
  });

  await createNotification({
    userId: returnReq.userId,
    recipientType: "user",
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "order",
    title: "Return Rejected",
    message: `Your return for order #${String(returnReq.orderId).slice(-8).toUpperCase()} was rejected. Reason: ${rejectionReason}`,
    link: `/dashboard/user/orders`,
    relatedId: returnReq.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  return returnReq;
}

async function createReverseDelivery(returnReq: any): Promise<IReverseDeliveryRequest> {
  const otp = crypto.randomInt(100000, 999999).toString();

  const reverse = await ReverseDeliveryRequest.create({
    returnRequestId: String(returnReq._id),
    orderId: returnReq.orderId,
    orderItemId: returnReq.orderItemId,
    productTitle: returnReq.productTitle,
    productImage: returnReq.productImage,
    customerId: returnReq.userId,
    customerName: returnReq.customerName || "",
    customerAddress: returnReq.pickupAddress || "",
    sellerId: returnReq.sellerId,
    sellerName: returnReq.sellerName || "",
    sellerAddress: returnReq.sellerReturnAddress || "",
    deliveryOtp: otp,
    priority: "normal",
    status: "available",
    statusHistory: [{ status: "available", at: new Date(), note: "Reverse delivery request created" }],
  });

  returnReq.status = "reverse_available";
  appendStatus(returnReq, "reverse_available", "Reverse delivery request created");
  await returnReq.save();

  return reverse;
}

export async function getSellerReturns(sellerId: string) {
  const returns = await ReturnRequest.find({ sellerId }).sort({ createdAt: -1 }).lean();
  return returns.map(normalizeLean);
}

export async function getDeliveryReverseRequests(deliveryManId: string) {
  const requests = await ReverseDeliveryRequest.find({ status: "available" }).sort({ priority: -1, createdAt: -1 }).lean();
  return requests.map(normalizeLean);
}

export async function getDeliveryMyReverseRequests(deliveryManId: string) {
  const requests = await ReverseDeliveryRequest.find({ assignedDeliveryManId: deliveryManId }).sort({ createdAt: -1 }).lean();
  return requests.map(normalizeLean);
}

export async function acceptReverseDelivery(reverseId: string, deliveryManId: string, deliveryManName: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");
  if (reverse.status !== "available") throw ApiError.conflict("Reverse delivery request is no longer available");

  // Verify delivery man eligibility (reuse existing acceptance logic from delivery.controller.ts)
  const { DeliveryManProfile } = await import("../../delivery/delivery-man.model");
  const { DeliveryManDetails } = await import("../../delivery/delivery-man.model");

  const profile = await DeliveryManProfile.findOne({ userId: deliveryManId });
  if (!profile || profile.status !== "approved") {
    throw ApiError.forbidden("Your delivery partner account is not approved.");
  }

  const details = await DeliveryManDetails.findOne({ userId: deliveryManId }).lean();
  if (details?.availabilityStatus === "offline") {
    throw ApiError.badRequest("You are currently offline. Please go online before accepting reverse deliveries.");
  }
  if (details?.availabilityStatus === "suspended") {
    throw ApiError.forbidden("Your delivery partner account is suspended.");
  }

  const maxActive = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;
  const activeCount = await ReverseDeliveryRequest.countDocuments({
    assignedDeliveryManId: deliveryManId,
    status: { $in: ["assigned", "accepted", "pickup_started", "picked_up", "in_transit"] },
  });

  if (activeCount >= maxActive) {
    throw ApiError.badRequest(`Capacity full: You have ${activeCount} active reverse deliveries. Maximum is ${maxActive}.`);
  }

  // Atomically claim the request (1st wins; subsequent parallel requests return null)
  const claimed = await ReverseDeliveryRequest.findOneAndUpdate(
    { _id: reverseId, status: "available" },
    {
      $set: {
        status: "assigned",
        assignedDeliveryManId: deliveryManId,
        assignedAt: new Date(),
      },
      $push: {
        statusHistory: { status: "assigned", at: new Date(), note: `Accepted by ${deliveryManName}` },
      },
    }
  );

  if (!claimed) throw ApiError.conflict("Another delivery partner accepted this request first.");

  const returnReq = await ReturnRequest.findOne({ deliveryRequestId: reverseId });
  if (returnReq) {
    returnReq.status = "reverse_assigned";
    returnReq.deliveryManId = deliveryManId;
    returnReq.deliveryManName = deliveryManName;
    appendStatus(returnReq, "reverse_assigned", `Assigned to ${deliveryManName}`);
    await returnReq.save();
  }

  await createNotification({
    userId: reverse.customerId,
    recipientType: "user",
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "delivery",
    title: "Return Pickup Assigned",
    message: `A delivery partner is assigned to pick up your return for order #${String(reverse.orderId).slice(-8).toUpperCase()}.`,
    link: `/dashboard/user/orders`,
    relatedId: reverse.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  await createNotification({
    userId: reverse.sellerId,
    recipientType: "seller",
    type: "delivery_alert",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Return Pickup Assigned",
    message: `A delivery partner is picking up the returned item for order #${String(reverse.orderId).slice(-8).toUpperCase()}.`,
    link: `/dashboard/seller/orders`,
    relatedId: reverse.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  emitDeliveryEvent(String(claimed._id), "delivery:status_change", {
    deliveryId: String(claimed._id),
    orderId: claimed.orderId,
    status: "assigned",
    riderId: deliveryManId,
    riderName: deliveryManName,
  });

  return claimed;
}

export async function updateReverseDeliveryStatus(
  reverseId: string,
  status: IReverseDeliveryRequest["status"],
  actorId: string,
  actorRole: string,
  payload?: { failureReason?: string; deliveryOtp?: string; deliveryProofImage?: string; note?: string }
) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");

  if (actorRole !== "admin" && reverse.assignedDeliveryManId !== actorId) {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }

  const validTransitions: Record<string, string[]> = {
    available: ["assigned", "cancelled"],
    assigned: ["accepted", "pickup_started", "cancelled", "failed"],
    accepted: ["pickup_started", "cancelled", "failed"],
    pickup_started: ["picked_up", "cancelled", "failed"],
    picked_up: ["in_transit", "failed"],
    in_transit: ["seller_received", "failed"],
    seller_received: [],
    failed: ["available", "cancelled"],
    cancelled: ["available"],
  };

  const allowed = validTransitions[reverse.status];
  if (!allowed || !allowed.includes(status)) {
    throw ApiError.badRequest(`Cannot transition reverse delivery from ${reverse.status} to ${status}`);
  }

  // OTP verification for pickup completion (picked_up requires correct OTP)
  if (status === "picked_up") {
    if (!payload?.deliveryOtp) {
      throw ApiError.badRequest("OTP is required to complete pickup verification");
    }
    if (reverse.deliveryOtp !== payload.deliveryOtp) {
      throw ApiError.badRequest("Invalid OTP code");
    }
  }

  reverse.status = status;
  const now = new Date();
  if (status === "accepted") reverse.acceptedAt = now;
  if (status === "pickup_started") reverse.pickupStartedAt = now;
  if (status === "picked_up") {
    reverse.pickedUpAt = now;
    reverse.deliveryOtpVerifiedAt = now;
    reverse.deliveryOtp = undefined;
  }
  if (status === "in_transit") reverse.inTransitAt = now;
  if (status === "seller_received") reverse.sellerReceivedAt = now;
  if (status === "failed") reverse.failedAt = now;
  if (status === "cancelled") reverse.cancelledAt = now;
  if (payload?.deliveryOtp && status !== "picked_up") reverse.deliveryOtp = payload.deliveryOtp;
  if (payload?.deliveryProofImage) reverse.deliveryProofImage = payload.deliveryProofImage;
  if (payload?.failureReason) reverse.deliveryFailedReason = payload.failureReason;

  reverse.statusHistory.push({ status, at: now, note: payload?.note });
  await reverse.save();

  const returnReq = await ReturnRequest.findOne({ deliveryRequestId: reverseId });
  if (returnReq) {
    const reverseStatusToReturnStatus: Partial<Record<IReverseDeliveryRequest["status"], IReturnRequest["status"]>> = {
      picked_up: "picked_up",
      in_transit: "in_transit",
      failed: "failed",
      cancelled: "cancelled",
    };
    const previousStatus = returnReq.status;
    const mapped = reverseStatusToReturnStatus[status] ?? previousStatus;
    returnReq.status = mapped;
    if (status === "picked_up") returnReq.pickedUpAt = now;
    if (mapped !== previousStatus) appendStatus(returnReq, mapped, payload?.note);
    await returnReq.save();
  }

  if (status === "picked_up") {
    await createNotification({
      userId: reverse.sellerId,
      recipientType: "seller",
      type: "delivery_alert",
      category: "delivery",
      priority: "info",
      source: "delivery",
      title: "Return Picked Up",
      message: `Return item for order #${String(reverse.orderId).slice(-8).toUpperCase()} has been picked up and is on the way.`,
      link: `/dashboard/seller/orders`,
      relatedId: reverse.orderId,
      relatedType: "order",
    }).catch(() => undefined);
  }

  if (status === "seller_received") {
    await createNotification({
      userId: returnReq?.userId || reverse.customerId,
      recipientType: "user",
      type: "return_update",
      category: "orders",
      priority: "info",
      source: "order",
      title: "Return Delivery Completed",
      message: `The delivery partner marked the return for order #${String(reverse.orderId).slice(-8).toUpperCase()} as delivered to the seller. Seller confirmation and inspection will follow.`,
      link: `/dashboard/user/orders`,
      relatedId: reverse.orderId,
      relatedType: "order",
    }).catch(() => undefined);
  }

  emitDeliveryEvent(String(reverse._id), "delivery:status_change", {
    deliveryId: String(reverse._id),
    orderId: reverse.orderId,
    status,
    note: payload?.note,
  });

  return reverse;
}

export async function inspectReturn(returnId: string, actorId: string, actorName: string, inspectionStatus: "approved" | "rejected", inspectionNotes: string, resalable: boolean = true) {
  const returnReq = await ReturnRequest.findById(returnId);
  if (!returnReq) throw ApiError.notFound("Return request not found");
  if (returnReq.sellerId !== actorId) throw ApiError.forbidden("Only the seller can inspect this return");

  assertTransition(returnReq.status, "inspection_pending");

  returnReq.inspectionStatus = inspectionStatus;
  returnReq.inspectionNotes = inspectionNotes;
  appendStatus(returnReq, inspectionStatus === "approved" ? "inspection_approved" : "inspection_rejected", inspectionNotes);
  await returnReq.save();

  if (inspectionStatus === "approved") {
    returnReq.status = "refund_pending";
    appendStatus(returnReq, "refund_pending", "Inspection approved, refund queued");
    await returnReq.save();

    const order = await Order.findOne({ _id: returnReq.orderId, userId: returnReq.userId });
    const refundAmount = returnReq.calculatedRefundAmount || returnReq.requestedRefundAmount;

    const refund = await Refund.create({
      refundId: `REF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      returnRequestId: String(returnReq._id),
      orderId: returnReq.orderId,
      orderItemId: returnReq.orderItemId,
      customerId: returnReq.userId,
      sellerId: returnReq.sellerId,
      amount: refundAmount,
      currency: "BDT",
      provider: order?.paymentMethod || "unknown",
      status: "pending",
      reason: returnReq.reason,
    });

    returnReq.refundId = refund.refundId;
    await returnReq.save();

    if (resalable) {
      const product = await Product.findById(returnReq.productId);
      if (product) {
        const qty = Math.max(1, returnReq.quantity || 1);
        await Product.findByIdAndUpdate(returnReq.productId, { $inc: { stock: qty } });
      }
    }

    await createNotification({
      userId: returnReq.userId,
      recipientType: "user",
      type: "refund_alert",
      category: "payments",
      priority: "info",
      source: "refund",
      title: "Refund Processing",
      message: `Your refund of ৳${refundAmount} for order #${String(returnReq.orderId).slice(-8).toUpperCase()} is being processed.`,
      link: `/dashboard/user/orders`,
      relatedId: returnReq.orderId,
      relatedType: "order",
    }).catch(() => undefined);
  }

  if (inspectionStatus === "rejected") {
    returnReq.status = "refund_failed";
    appendStatus(returnReq, "refund_failed", `Inspection rejected: ${inspectionNotes}`);
    await returnReq.save();

    await createNotification({
      userId: returnReq.userId,
      recipientType: "user",
      type: "return_update",
      category: "orders",
      priority: "info",
      source: "order",
      title: "Return Inspection Rejected",
      message: `Your return for order #${String(returnReq.orderId).slice(-8).toUpperCase()} was rejected during inspection. Reason: ${inspectionNotes}`,
      link: `/dashboard/user/orders`,
      relatedId: returnReq.orderId,
      relatedType: "order",
    }).catch(() => undefined);
  }

  await AuditLog.create({
    actorId,
    actorName,
    role: "seller",
    action: `RETURN_INSPECTION_${inspectionStatus.toUpperCase()}`,
    resource: "ReturnRequest",
    resourceId: returnId,
    status: "success",
    details: { inspectionStatus, inspectionNotes },
  });

  return returnReq;
}

// ============================================================
// NEW FUNCTIONS: OTP, pickup, refund processing, admin
// ============================================================

export async function getReverseDeliveryDetails(reverseId: string, actorId: string, role: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId).lean();
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");

  // Authorization: customer (owner), delivery man (assigned), seller (related), admin
  if (role === "delivery_man" && reverse.assignedDeliveryManId !== actorId && reverse.status !== "available") {
    throw ApiError.forbidden("You don't have access to this reverse delivery");
  }
  if (role === "customer" && reverse.customerId !== actorId) {
    throw ApiError.forbidden("You can only view your own returns");
  }
  if (role === "seller" && reverse.sellerId !== actorId) {
    throw ApiError.forbidden("You can only view returns for your products");
  }

  const returnReq = await ReturnRequest.findOne({ deliveryRequestId: reverseId }).lean();

  return { reverseDelivery: normalizeLean(reverse), returnRequest: returnReq ? normalizeLean(returnReq) : null };
}

export async function generateReverseDeliveryOtp(reverseId: string, deliveryManId: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");
  if (reverse.assignedDeliveryManId !== deliveryManId) {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }
  if (reverse.status !== "pickup_started") {
    throw ApiError.badRequest("OTP can only be generated when pickup is in progress");
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  reverse.deliveryOtp = otp;
  await reverse.save();

  await AuditLog.create({
    actorId: deliveryManId,
    actorName: "Delivery Man",
    role: "system",
    action: "REVERSE_OTP_GENERATED",
    resource: "ReverseDeliveryRequest",
    resourceId: reverseId,
    status: "success",
    details: { orderId: reverse.orderId },
  });

  await createNotification({
    userId: reverse.customerId,
    recipientType: "user",
    type: "delivery_alert",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Pickup OTP Generated",
    message: `Your delivery partner has arrived for pickup. Please provide the OTP: ${otp}`,
    link: `/dashboard/user/orders`,
    relatedId: reverse.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  return otp;
}

export async function verifyReverseDeliveryOtp(reverseId: string, otp: string, actorId: string, role: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");

  if (role !== "admin" && reverse.assignedDeliveryManId !== actorId) {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }

  if (!reverse.deliveryOtp) throw ApiError.badRequest("No OTP has been generated for this pickup");
  if (reverse.deliveryOtp !== otp) throw ApiError.badRequest("Invalid OTP code");

  reverse.deliveryOtpVerifiedAt = new Date();
  reverse.deliveryOtp = undefined;
  await reverse.save();

  return { verified: true, reverseDelivery: reverse };
}

export async function startPickup(reverseId: string, deliveryManId: string, note?: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");
  if (reverse.assignedDeliveryManId !== deliveryManId) {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }
  if (reverse.status !== "accepted" && reverse.status !== "assigned") {
    throw ApiError.badRequest(`Cannot start pickup from status: ${reverse.status}`);
  }

  const now = new Date();
  const result = await ReverseDeliveryRequest.findOneAndUpdate(
    { _id: reverseId, status: { $in: ["accepted", "assigned"] } },
    {
      $set: { status: "pickup_started", pickupStartedAt: now },
      $push: { statusHistory: { status: "pickup_started", at: now, note } },
    },
    { new: true }
  );

  if (!result) throw ApiError.conflict("Reverse delivery status changed. Please refresh and try again.");

  const returnReq = await ReturnRequest.findOne({ deliveryRequestId: reverseId });
  if (returnReq && returnReq.status !== "pickup_started") {
    returnReq.status = "pickup_started";
    appendStatus(returnReq, "pickup_started", note || "Delivery partner started pickup");
    await returnReq.save();
  }

  emitDeliveryEvent(reverseId, "delivery:status_change", {
    deliveryId: reverseId,
    orderId: reverse.orderId,
    status: "pickup_started",
    note,
  });

  return result;
}

export async function completePickup(reverseId: string, deliveryManId: string, proofImage?: string, note?: string) {
  const reverse = await ReverseDeliveryRequest.findById(reverseId);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");
  if (reverse.assignedDeliveryManId !== deliveryManId) {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }
  if (reverse.status !== "pickup_started") {
    throw ApiError.badRequest("Pickup must be started before completing");
  }

  if (!reverse.deliveryOtpVerifiedAt) {
    throw ApiError.badRequest("OTP must be verified before marking picked up");
  }

  const now = new Date();
  const result = await ReverseDeliveryRequest.findOneAndUpdate(
    { _id: reverseId, status: "pickup_started" },
    {
      $set: {
        status: "picked_up",
        pickedUpAt: now,
        deliveryOtpVerifiedAt: now,
        deliveryOtp: undefined,
        deliveryProofImage: proofImage || reverse.deliveryProofImage,
      },
      $push: { statusHistory: { status: "picked_up", at: now, note } },
    },
    { new: true }
  );

  if (!result) throw ApiError.conflict("Reverse delivery status changed. Please refresh and try again.");

  const returnReq = await ReturnRequest.findOne({ deliveryRequestId: reverseId });
  if (returnReq) {
    returnReq.status = "picked_up";
    returnReq.pickedUpAt = now;
    appendStatus(returnReq, "picked_up", note || "Product picked up for return");
    await returnReq.save();
  }

  await createNotification({
    userId: reverse.sellerId,
    recipientType: "seller",
    type: "delivery_alert",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Return Picked Up",
    message: `Return item for order #${String(reverse.orderId).slice(-8).toUpperCase()} has been picked up and is on the way.`,
    link: `/dashboard/seller/orders`,
    relatedId: reverse.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  emitDeliveryEvent(reverseId, "delivery:status_change", {
    deliveryId: reverseId,
    orderId: reverse.orderId,
    status: "picked_up",
    note,
  });

  return result;
}

export async function sellerReceiveReturn(returnId: string, sellerId: string, proofImage?: string, note?: string) {
  const returnReq = await ReturnRequest.findById(returnId);
  if (!returnReq) throw ApiError.notFound("Return request not found");
  if (returnReq.sellerId !== sellerId) throw ApiError.forbidden("Only the seller can receive this return");
  if (returnReq.status !== "picked_up" && returnReq.status !== "in_transit") {
    throw ApiError.badRequest("Return must be picked up or in transit to receive");
  }

  const now = new Date();
  returnReq.status = "inspection_pending";
  returnReq.receivedBySellerAt = now;

  const reverse = await ReverseDeliveryRequest.findOne({ returnRequestId: returnId });
  if (reverse && ["picked_up", "in_transit", "seller_received"].includes(reverse.status)) {
    if (reverse.status !== "seller_received") {
      reverse.status = "seller_received";
      reverse.statusHistory.push({ status: "seller_received", at: now, note: note || "Product received by seller" });
    }
    reverse.sellerReceivedAt = now;
    if (proofImage) reverse.deliveryProofImage = proofImage;
    await reverse.save();
  }

  appendStatus(returnReq, "seller_received", note || "Product received by seller");
  appendStatus(returnReq, "inspection_pending", "Ready for inspection");
  await returnReq.save();

  await AuditLog.create({
    actorId: sellerId,
    actorName: "Seller",
    role: "seller",
    action: "RETURN_RECEIVED_BY_SELLER",
    resource: "ReturnRequest",
    resourceId: returnId,
    status: "success",
    details: { orderId: returnReq.orderId, productId: returnReq.productId },
  });

  if (reverse) {
    emitDeliveryEvent(String(reverse._id), "delivery:status_change", {
      deliveryId: String(reverse._id),
      orderId: reverse.orderId,
      status: "seller_received",
      note,
    });
  }

  await createNotification({
    userId: returnReq.userId,
    recipientType: "user",
    type: "return_update",
    category: "orders",
    priority: "info",
    source: "order",
    title: "Return Received by Seller",
    message: `Your return for order #${String(returnReq.orderId).slice(-8).toUpperCase()} has been received by the seller. Inspection will follow.`,
    link: `/dashboard/user/orders`,
    relatedId: returnReq.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  return returnReq;
}

export async function processRefund(refundId: string, actorId: string, role: string) {
  const refund = await Refund.findById(refundId);
  if (!refund) {
    const refundByString = await Refund.findOne({ refundId: String(refundId) });
    if (!refundByString) throw ApiError.notFound("Refund not found");
    return processRefundLogic(refundByString, actorId, role);
  }
  return processRefundLogic(refund, actorId, role);
}

async function processRefundLogic(refund: IRefund, actorId: string, role: string) {
  const refundDoc = refund as any;

  // Authorization
  if (role !== "admin" && refundDoc.sellerId !== actorId) {
    throw ApiError.forbidden("You can only process refunds for your own returns");
  }

  // Idempotency: prevent duplicate refund processing
  if (refundDoc.status === "succeeded") {
    return { refund: refundDoc, message: "Refund already processed successfully" };
  }
  if (refundDoc.status === "processing") {
    return { refund: refundDoc, message: "Refund is already being processed" };
  }
  if (refundDoc.status === "failed") {
    throw ApiError.badRequest("Refund has already failed");
  }

  // Validate required fields
  if (!refundDoc.customerId || !refundDoc.orderId) {
    throw ApiError.badRequest("Refund record is missing required references");
  }

  const now = new Date();
  refundDoc.status = "processing";
  refundDoc.processedAt = now;
  await refundDoc.save();

  const returnReq = await ReturnRequest.findOne({ refundId: refundDoc.refundId });
  if (returnReq) {
    returnReq.status = "refund_processing";
    appendStatus(returnReq, "refund_processing", "Refund initiated with payment provider");
    await returnReq.save();
  }

  try {
    // Actual refund processing based on payment provider
    let providerRefundId: string | undefined;

    if (refundDoc.provider === "card" || refundDoc.provider === "stripe") {
      const payment = await PaymentRecord.findOne({
        orderId: refundDoc.orderId,
        status: "successful",
      }).lean();

      if (payment?.transactionId) {
        const stripeRefund = await stripe.refunds.create({
          payment_intent: payment.transactionId,
          amount: Math.round(refundDoc.amount * 100),
          currency: refundDoc.currency.toLowerCase(),
          metadata: {
            orderId: refundDoc.orderId,
            returnRequestId: refundDoc.returnRequestId,
            refundId: refundDoc.refundId,
          },
        });
        providerRefundId = stripeRefund.id;
      } else {
        throw new Error("No successful payment record found for this order");
      }
      refundDoc.status = "succeeded";
    } else if (refundDoc.provider === "sslcommerz" || refundDoc.provider === "mobile_banking" || refundDoc.provider === "bank_transfer") {
      await createAdminNotification({
        type: "refund_alert",
        category: "payments",
        priority: "high",
        source: "refund",
        title: "Manual Refund Required",
        message: `Manual refund required: ${refundDoc.amount} BDT for order #${String(refundDoc.orderId).slice(-8).toUpperCase()}. Provider: ${refundDoc.provider}.`,
        link: `/dashboard/admin/returns`,
        relatedId: refundDoc.refundId,
        relatedType: "refund",
      }).catch(() => undefined);
      refundDoc.status = "pending";
      providerRefundId = `MANUAL-${refundDoc.provider.toUpperCase()}-PENDING`;
    } else if (refundDoc.provider === "cash_on_delivery") {
      await createAdminNotification({
        type: "refund_alert",
        category: "payments",
        priority: "high",
        source: "refund",
        title: "COD Refund - Wallet Credit Required",
        message: `COD order refund: ${refundDoc.amount} BDT needs to be credited to customer wallet for order #${String(refundDoc.orderId).slice(-8).toUpperCase()}.`,
        link: `/dashboard/admin/returns`,
        relatedId: refundDoc.refundId,
        relatedType: "refund",
      }).catch(() => undefined);
      refundDoc.status = "pending";
      providerRefundId = `COD-WALLET-CREDIT-PENDING`;
    }

    refundDoc.providerRefundId = providerRefundId;
    refundDoc.processedAt = new Date();
    await refundDoc.save();

    if (returnReq) {
      returnReq.status = "refunded";
      appendStatus(returnReq, "refunded", providerRefundId ? `Refund processed via ${refundDoc.provider}` : "Refund marked as processing");
      await returnReq.save();
    }

    await createNotification({
      userId: refundDoc.customerId,
      recipientType: "user",
      type: "refund_alert",
      category: "payments",
      priority: "info",
      source: "refund",
      title: "Refund Completed",
      message: providerRefundId
        ? `Your refund of ৳${refundDoc.amount} for order #${String(refundDoc.orderId).slice(-8).toUpperCase()} has been processed successfully.`
        : `Your refund of ৳${refundDoc.amount} for order #${String(refundDoc.orderId).slice(-8).toUpperCase()} has been initiated. It will reach you soon.`,
      link: `/dashboard/user/orders`,
      relatedId: refundDoc.orderId,
      relatedType: "order",
    }).catch(() => undefined);

    const auditRole = role === "admin" ? "admin" : role === "customer" ? "customer" : "seller" as IAuditLog["role"];
    await AuditLog.create({
      actorId,
      actorName: role,
      role: auditRole,
      action: "REFUND_PROCESSED",
      resource: "Refund",
      resourceId: refundDoc.refundId,
      status: "success",
      details: { orderId: refundDoc.orderId, amount: refundDoc.amount, providerRefundId },
    });

    return { refund: refundDoc, providerRefundId };
  } catch (error: any) {
    refundDoc.status = "failed";
    refundDoc.failedAt = new Date();
    refundDoc.failureReason = error?.message || "Refund processing failed";
    await refundDoc.save();

    if (returnReq) {
      returnReq.status = "refund_failed";
      appendStatus(returnReq, "refund_failed", `Refund failed: ${error?.message || "Unknown error"}`);
      await returnReq.save();
    }

    await createAdminNotification({
      type: "refund_alert",
      category: "payments",
      priority: "critical",
      source: "refund",
      title: "Refund Failed",
      message: `Refund of ৳${refundDoc.amount} for order #${String(refundDoc.orderId).slice(-8).toUpperCase()} failed: ${error?.message || "Unknown error"}`,
      link: `/dashboard/admin/returns`,
      relatedId: refundDoc.refundId,
      relatedType: "refund",
    }).catch(() => undefined);

    await createNotification({
      userId: refundDoc.customerId,
      recipientType: "user",
      type: "refund_alert",
      category: "payments",
      priority: "warning",
      source: "refund",
      title: "Refund Failed",
      message: `Your refund of ৳${refundDoc.amount} for order #${String(refundDoc.orderId).slice(-8).toUpperCase()} could not be processed automatically. Our team has been notified.`,
      link: `/dashboard/user/orders`,
      relatedId: refundDoc.orderId,
      relatedType: "order",
    }).catch(() => undefined);

    throw ApiError.internal("Refund processing failed. Please try again or contact support.");
  }
}

export async function getAdminReturns(filters: {
  status?: string;
  refundStatus?: string;
  sellerId?: string;
  customerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters.status && filters.status !== "all") {
    query.status = filters.status;
  }
  if (filters.sellerId) query.sellerId = filters.sellerId;
  if (filters.customerId) query.userId = filters.customerId;

  if (filters.search) {
    const searchRegex = { $regex: filters.search, $options: "i" };
    query.$or = [
      { orderId: searchRegex },
      { productId: searchRegex },
      { reason: searchRegex },
      { refundId: searchRegex },
    ];
  }

  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) (query.createdAt as any).$gte = new Date(filters.dateFrom);
    if (filters.dateTo) (query.createdAt as any).$lte = new Date(filters.dateTo);
  }

  const returns = await ReturnRequest.find(query).sort({ createdAt: -1 }).lean();

  return {
    returns: returns.map((r) => ({
      ...normalizeLean(r),
      orderIdShort: String(r.orderId).slice(-8).toUpperCase(),
      refund: r.refundId ? { refundId: r.refundId } : null,
    })),
    total: returns.length,
  };
}

export async function getAdminReturnDetails(returnId: string) {
  const returnReq = await ReturnRequest.findById(returnId).lean();
  if (!returnReq) throw ApiError.notFound("Return request not found");

  const order = await Order.findById(returnReq.orderId).lean();
  const refunds = await Refund.find({ returnRequestId: returnId }).lean();
  const reverseDelivery = returnReq.deliveryRequestId
    ? await ReverseDeliveryRequest.findById(returnReq.deliveryRequestId).lean()
    : null;

  const auditLogs = await AuditLog.find({
    $or: [{ resourceId: returnId }, { "details.returnRequestId": returnId }],
  }).sort({ createdAt: -1 }).lean();

  return {
    returnRequest: normalizeLean(returnReq),
    order: order ? normalizeLean(order) : null,
    refunds: refunds.map(normalizeLean),
    reverseDelivery: reverseDelivery ? normalizeLean(reverseDelivery) : null,
    auditLogs,
  };
}
