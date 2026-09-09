import { Request, Response } from "express";
import { Order } from "./order.model";
import { Cart } from "../cart/cart.model";
import { Product } from "../products/product.model";
import { ProductLifecycle } from "../customer/customer-intelligence.model";
import { Coupon, computeDiscount, isFreeShippingCouponApplicable } from "../coupons/coupon.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { flagSuspiciousOrder } from "../security/security.service";
import { recomputeStoreTrustScore } from "../trust/trust.service";
import { createNotification } from "../notifications/notification.service";
import mongoose from "mongoose";

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { shippingAddress, division, paymentMethod, couponCode } = req.body as {
    shippingAddress: string;
    division: string;
    paymentMethod: string;
    couponCode?: string;
  };

  const cart = await Cart.findOne({ userId: req.user!.id });
  if (!cart || cart.items.length === 0) throw ApiError.badRequest("Your cart is empty");

  const orderItems = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = await Product.findOne({ _id: item.productId, isDeleted: false });
    if (!product) throw ApiError.badRequest(`A product in your cart is no longer available`);
    if (product.stock < item.quantity) {
      throw ApiError.badRequest(`Insufficient stock for "${product.title}"`);
    }
    const price = product.discountPrice ?? product.price;
    subtotal += price * item.quantity;
    orderItems.push({
      productId: product.id,
      storeId: product.storeId,
      sellerId: product.sellerId,
      category: product.category,
      title: product.title,
      quantity: item.quantity,
      price,
      image: product.images?.[0] ?? undefined,
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  let discount = 0;
  let freeShipping = false;
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (!coupon) throw ApiError.badRequest("Invalid coupon code");

    // free-shipping coupons don't reduce the product subtotal — they waive the
    // delivery fee. Validate eligibility through the shipping path; the discount
    // stays 0 and deliveryFee is zeroed below.
    if (coupon.type === "free-shipping") {
      if (!isFreeShippingCouponApplicable(coupon, orderItems)) {
        throw ApiError.badRequest("Coupon is not applicable to this order");
      }
      freeShipping = true;
    } else {
      discount = computeDiscount(coupon, orderItems);
      if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");
    }

    coupon.usedCount += 1;
    await coupon.save();
  }

  const deliveryFee = freeShipping ? 0 : division === "Dhaka" ? 60 : 120;
  const totalAmount = Math.round((subtotal - discount + deliveryFee) * 100) / 100;

  const order = await Order.create({
    userId: req.user!.id,
    items: orderItems,
    subtotal,
    discount,
    division,
    deliveryFee,
    couponCode,
    totalAmount,
    shippingAddress,
    paymentMethod,
    status: "pending",
    statusHistory: [{ status: "pending", at: new Date() }],
  });

  // Decrement stock + bump sold count for each purchased product.
  await Promise.all(
    orderItems.map((i) =>
      Product.findByIdAndUpdate(i.productId, { $inc: { stock: -i.quantity, sold: i.quantity } })
    )
  );

  cart.items = [];
  await cart.save();

  // Fire-and-forget fraud heuristics; never block the checkout flow on this.
  flagSuspiciousOrder(order).catch(() => undefined);
  const storeIds = [...new Set(orderItems.map((i) => i.storeId))];
  Promise.all(storeIds.map((id) => recomputeStoreTrustScore(id))).catch(() => undefined);

  sendSuccess(res, order.toJSON(), "Order placed", 201);
});

export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json(orders);
});

export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.userId === req.user!.id;
  const isSellerOnOrder = order.items.some((i) => i.sellerId === req.user!.id);
  if (!isOwner && !isSellerOnOrder && req.user!.role !== "admin") {
    throw ApiError.forbidden("You cannot view this order");
  }

  let customerEmail = req.user?.email || "";
  if (!customerEmail && mongoose.connection.db && order.userId) {
    const userDoc = await mongoose.connection.db.collection("user").findOne({
      $or: [
        { id: order.userId },
        {
          _id: (mongoose.Types.ObjectId.isValid(order.userId)
            ? new mongoose.Types.ObjectId(order.userId)
            : null) as any,
        },
      ],
    });
    if (userDoc?.email) customerEmail = userDoc.email;
  }

  sendSuccess(res, { ...order.toJSON(), customerEmail });
});

/** GET /orders/seller/mine - orders that include at least one of the seller's products */
export const getSellerOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ "items.sellerId": req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json(orders);
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: string };
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isSellerOnOrder = order.items.some((i) => i.sellerId === req.user!.id);
  if (req.user!.role !== "admin" && !isSellerOnOrder) {
    throw ApiError.forbidden("You cannot update this order");
  }

  const previousStatus = order.status;
  order.status = status as typeof order.status;
  order.statusHistory.push({ status: order.status, at: new Date() });
  if (status === "delivered") order.paymentStatus = "paid";
  await order.save();

  if (previousStatus !== status) {
    const statusMessages: Record<string, { title: string; message: string; type: string; category: string }> = {
      confirmed: {
        title: "Order Confirmed",
        message: `Your order #${order.id} has been confirmed and is being processed.`,
        type: "order_confirmation",
        category: "orders",
      },
      processing: {
        title: "Order Processing",
        message: `Your order #${order.id} is now being processed.`,
        type: "order_update",
        category: "orders",
      },
      shipped: {
        title: "Order Shipped",
        message: `Your order #${order.id} has been shipped and is on its way.`,
        type: "order_shipped",
        category: "orders",
      },
      out_for_delivery: {
        title: "Out for Delivery",
        message: `Your order #${order.id} is out for delivery.`,
        type: "delivery_alert",
        category: "delivery",
      },
      delivered: {
        title: "Order Delivered",
        message: `Your order #${order.id} has been delivered. Thank you for shopping with us!`,
        type: "order_delivered",
        category: "orders",
      },
      cancelled: {
        title: "Order Cancelled",
        message: `Your order #${order.id} has been cancelled.`,
        type: "order_cancelled",
        category: "orders",
      },
    };

    const notificationData = statusMessages[status];
    if (notificationData) {
      createNotification({
        userId: order.userId,
        type: notificationData.type as any,
        category: notificationData.category as any,
        priority: status === "cancelled" ? "warning" : "info",
        source: "order",
        title: notificationData.title,
        message: notificationData.message,
        link: `/orders/${order.id}`,
        relatedId: order.id,
        relatedType: "order",
      }).catch((err) => console.warn("Failed to create order notification", err));
    }
  }

  if (previousStatus !== "delivered" && status === "delivered") {
    const productIds = order.items.map((i) => i.productId);
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    for (const item of order.items) {
      const existing = await ProductLifecycle.findOne({ userId: order.userId, orderId: order.id, productId: item.productId });
      if (existing) continue;

      const product = productMap.get(item.productId);
      let warrantyExpiryDate: Date | undefined;
      let warrantyProvider: string | undefined;
      let warrantyDurationMonths: number | undefined;
      let warrantyStartDate: Date | undefined;

      if (product?.warrantyMonths && product.warrantyMonths > 0) {
        warrantyDurationMonths = product.warrantyMonths;
        warrantyStartDate = new Date(order.createdAt);
        warrantyExpiryDate = new Date(warrantyStartDate);
        if (warrantyDurationMonths) {
          warrantyExpiryDate.setMonth(warrantyExpiryDate.getMonth() + warrantyDurationMonths);
        }
        warrantyProvider = product.warrantyProvider || "Seller";
      }

      await ProductLifecycle.create({
        userId: order.userId,
        orderId: order.id,
        productId: item.productId,
        productTitle: item.title,
        category: product?.category || "General",
        purchaseDate: order.createdAt,
        estimatedLifespanMonths: 36,
        usagePercentage: 5,
        warrantyProvider,
        warrantyDurationMonths,
        warrantyStartDate,
        warrantyExpiryDate,
        maintenanceReminders: [],
        status: "active",
      });
    }
  }

  sendSuccess(res, order.toJSON(), "Order status updated");
});

export const listAllOrdersForAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as { status?: string };
  const filter = status ? { status } : {};
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(500);
  res.status(200).json(orders);
});

export const getAdminOrderStats = asyncHandler(async (_req: Request, res: Response) => {
  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const [
    totalOrders,
    totalGmvAgg,
    pendingOrders,
    processingOrders,
    shippedOrders,
    deliveredOrders,
    cancelledOrders,
  ] = await Promise.all([
    Order.countDocuments({}),
    Order.aggregate([
      { $match: { status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Order.countDocuments({ status: "pending" }),
    Order.countDocuments({ status: "processing" }),
    Order.countDocuments({ status: { $in: ["shipped", "out_for_delivery"] } }),
    Order.countDocuments({ status: "delivered" }),
    Order.countDocuments({ status: "cancelled" }),
  ]);

  const totalGmv = totalGmvAgg[0]?.total || 0;

  sendSuccess(res, {
    totalOrders,
    totalGmv,
    pendingOrders,
    processingOrders,
    shippedOrders,
    deliveredOrders,
    cancelledOrders,
  });
});

export const searchAdminOrders = asyncHandler(async (req: Request, res: Response) => {
  const {
    q,
    status,
    paymentStatus,
    paymentMethod,
    seller,
    dateFrom,
    dateTo,
    sortBy = "createdAt",
    sortDir = "-1",
    page = "1",
    limit = "20",
  } = req.query as {
    q?: string;
    status?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    seller?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortDir?: string;
    page?: string;
    limit?: string;
  };

  const filter: Record<string, unknown> = {};

  if (status && status !== "all") filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (paymentMethod) filter.paymentMethod = paymentMethod;

  if (seller) {
    filter["items.sellerId"] = seller;
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {} as Record<string, Date>;
    if (dateFrom) (filter.createdAt as Record<string, Date>).$gte = new Date(dateFrom);
    if (dateTo) (filter.createdAt as Record<string, Date>).$lte = new Date(dateTo);
  }

  if (q) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { _id: regex },
      { shippingAddress: regex },
      { "items.title": regex },
      { "items.productId": regex },
    ];
  }

  const sortField = ["createdAt", "updatedAt", "totalAmount", "status"].includes(sortBy) ? sortBy : "createdAt";
  const sortOrder = sortDir === "1" ? 1 : -1;

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  sendSuccess(res, {
    orders,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const cancelOrderAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };
  const adminId = req.user?.id || "admin";

  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound("Order not found");

  if (order.status === "cancelled") {
    throw ApiError.badRequest("Order is already cancelled");
  }

  if (order.status === "delivered") {
    throw ApiError.badRequest("Cannot cancel a delivered order");
  }

  const previousStatus = order.status;
  order.status = "cancelled";
  order.statusHistory.push({ status: "cancelled", at: new Date() });
  await order.save();

  sendSuccess(res, order.toJSON(), `Order cancelled${reason ? `: ${reason}` : ""}`);
});
