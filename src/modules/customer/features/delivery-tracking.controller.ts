import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { DeliveryZone } from "../../delivery/delivery-zone.model";
import { DeliveryFeedback } from "../customer-extras.model";

export const getDeliveryEstimate = asyncHandler(async (req: Request, res: Response) => {
  const { division, district, upazila, productId } = req.query as { division?: string; district?: string; upazila?: string; productId?: string };
  if (!division) throw ApiError.badRequest("Division is required");

  const zoneFilter: Record<string, unknown> = { isActive: true, divisions: { $in: [division] } };
  if (district) zoneFilter.districts = { $in: [district] };
  const zone = await DeliveryZone.findOne(zoneFilter);

  let productAvailable = true;
  if (productId) {
    const product = await Product.findById(productId);
    if (!product) throw ApiError.notFound("Product not found");
    productAvailable = product.stock > 0 && product.status === "approved";
  }

  const isDhaka = division.toLowerCase().includes("dhaka");
  const estimatedDays = zone?.estimatedDays || (isDhaka ? 1 : 3);
  const deliveryFee = zone?.baseFee || (isDhaka ? 60 : 120);

  sendSuccess(res, {
    division, district: district || null, upazila: upazila || null,
    deliveryAvailable: true, codAvailable: true, estimatedDays: `${estimatedDays}-${estimatedDays + 1}`,
    deliveryFee, currency: "BDT", zoneName: zone?.name || (isDhaka ? "Inside Dhaka" : "Outside Dhaka"),
    productAvailable, sellerSupportsArea: true, freeDeliveryAbove: 2000,
  });
});

// ============================================================
// ADVANCED ORDER TRACKING (Feature 10)
// ============================================================

export const getAdvancedTracking = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId } = req.params;
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");

  const statusFlow = [
    { key: "pending", label: "Order Confirmed", icon: "✓" },
    { key: "confirmed", label: "Seller Processing", icon: "⚙" },
    { key: "processing", label: "Packed", icon: "📦" },
    { key: "shipped", label: "Handed to Courier", icon: "🚚" },
    { key: "out_for_delivery", label: "In Transit", icon: "🛣" },
    { key: "delivered", label: "Delivered", icon: "🎉" },
  ];

  const currentStatusIndex = statusFlow.findIndex((s) => s.key === order.status);
  const timeline = statusFlow.map((step, index) => ({
    ...step, completed: index <= currentStatusIndex, current: index === currentStatusIndex,
    timestamp: order.statusHistory?.find((h) => h.status === step.key)?.at || null,
  }));

  const productIds = order.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } }).select("title images");
  const productMap = new Map(products.map((p) => [p.id, p]));

  sendSuccess(res, {
    orderId: order.id, status: order.status, currentStatus: statusFlow[currentStatusIndex]?.label || order.status,
    timeline, items: order.items.map((item) => ({ ...item, image: productMap.get(item.productId)?.images?.[0] || "" })),
    totalAmount: order.totalAmount, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
    estimatedDelivery: order.status === "delivered" ? null : "2-3 business days", placedAt: order.createdAt,
  });
});

// ============================================================
// SMART RETURN CENTER (Feature 11)
// ============================================================

export const submitDeliveryFeedback = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId, courierName, speedRating, packagingRating, courierBehaviorRating, overallRating, feedbackText } = req.body;

  const feedback = await DeliveryFeedback.findOneAndUpdate(
    { userId, orderId },
    {
      userId,
      orderId,
      courierName: courierName || "Standard Express",
      speedRating: Number(speedRating) || 5,
      packagingRating: Number(packagingRating) || 5,
      courierBehaviorRating: Number(courierBehaviorRating) || 5,
      overallRating: Number(overallRating) || 5,
      feedbackText: feedbackText || "",
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, feedback, "Thank you for your delivery feedback!");
});

export const getDeliveryFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const feedback = await DeliveryFeedback.findOne({ orderId, userId: req.user!.id });
  sendSuccess(res, feedback);
});

// ============================================================
// 16. PRODUCT PROBLEM REPORTER (Feature 29)
// ============================================================
