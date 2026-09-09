import { Request, Response } from "express";
import { Order } from "./order.model";
import { Cart } from "../cart/cart.model";
import { Product } from "../products/product.model";
import { Coupon, computeDiscount, isFreeShippingCouponApplicable } from "../coupons/coupon.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { flagSuspiciousOrder } from "../security/security.service";
import { recomputeStoreTrustScore } from "../trust/trust.service";
import mongoose from "mongoose";
import { PaymentRecord } from "../customer/customer-features.model";

/**
 * Controller: Create New Order (Checkout)
 *
 * 1. Inputs Extracted:
 *    - req.user.id: ID of the logged-in customer placing the order
 *    - req.body: shippingAddress, division, paymentMethod, couponCode (optional)
 * 2. Database Operation:
 *    - Cart.findOne({ userId }) to read items
 *    - Product.findOne for each item to verify live stock and pricing
 *    - Coupon.findOne if couponCode provided, increments usedCount
 *    - Order.create(...) to save the order
 *    - Product.findByIdAndUpdate(...) to reduce stock and increase sold counts
 *    - Cart.save() to clear the user's cart
 * 3. Response Sent:
 *    - HTTP 201: Created order JSON object with message "Order placed"
 */
export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { shippingAddress, division, paymentMethod, couponCode } = req.body as {
    shippingAddress: string;
    division: string;
    paymentMethod: string;
    couponCode?: string;
  };

  // Find user's cart
  const cart = await Cart.findOne({ userId: req.user!.id });
  if (!cart || cart.items.length === 0) {
    throw ApiError.badRequest("Your cart is empty");
  }

  const orderItems = [];
  let subtotal = 0;

  // Validate stock and snapshot prices
  for (const item of cart.items) {
    const product = await Product.findOne({ _id: item.productId, isDeleted: false });
    if (!product) {
      throw ApiError.badRequest("A product in your cart is no longer available");
    }
    if (product.stock < item.quantity) {
      throw ApiError.badRequest(`Insufficient stock for "${product.title}"`);
    }

    const price = product.discountPrice ?? product.price;
    subtotal += price * item.quantity;

    orderItems.push({
      productId: product.id,
      storeId: product.storeId,
      sellerId: product.sellerId,
      title: product.title,
      quantity: item.quantity,
      price,
      image: product.images?.[0] ?? undefined,
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  // Apply optional coupon discount
  let discount = 0;
  let waiveDeliveryFee = false;
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (!coupon) throw ApiError.badRequest("Invalid coupon code");

    if (coupon.type === "free-shipping") {
      // Free-shipping coupons don't discount the subtotal — they waive the
      // delivery fee below instead.
      if (!isFreeShippingCouponApplicable(coupon, subtotal)) {
        throw ApiError.badRequest("Coupon is not applicable to this order");
      }
      waiveDeliveryFee = true;
    } else {
      discount = computeDiscount(coupon, subtotal);
      if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");
    }

    coupon.usedCount += 1;
    await coupon.save();
  }

  // Delivery fee rules: 60 inside Dhaka, 120 outside — waived entirely by a
  // valid, applicable free-shipping coupon.
  const deliveryFee = waiveDeliveryFee ? 0 : division === "Dhaka" ? 60 : 120;
  const totalAmount = Math.round((subtotal - discount + deliveryFee) * 100) / 100;

  // Create the order document
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

  // Decrement stock and increment sold count for each ordered item
  await Promise.all(
    orderItems.map((i) =>
      Product.findByIdAndUpdate(i.productId, { $inc: { stock: -i.quantity, sold: i.quantity } })
    )
  );

  // Empty the cart
  cart.items = [];
  await cart.save();

  // For Cash on Delivery, record an initial pending payment record
  if (paymentMethod === "cod" || paymentMethod === "cash_on_delivery") {
    await PaymentRecord.create({
      userId: req.user!.id,
      orderId: order._id.toString(),
      amount: order.totalAmount,
      method: "cash_on_delivery",
      status: "pending",
      description: `Cash on Delivery for Order #${order._id.toString().slice(-6).toUpperCase()}`,
    }).catch((err) => console.error("Failed to create COD payment record:", err));
  }

  // Background non-blocking notifications / risk checks
  flagSuspiciousOrder(order).catch(() => undefined);
  const storeIds = [...new Set(orderItems.map((i) => i.storeId))];
  Promise.all(storeIds.map((id) => recomputeStoreTrustScore(id))).catch(() => undefined);

  sendSuccess(res, order.toJSON(), "Order placed", 201);
});

/**
 * Controller: Get Logged-In User's Orders
 *
 * 1. Inputs Extracted:
 *    - req.user.id: ID of the logged-in customer
 * 2. Database Operation:
 *    - Order.find({ userId }).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of user's orders (Order[])
 */
export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json(orders);
});

/**
 * Controller: Get Single Order By ID
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Order ID
 *    - req.user: Logged-in user information (id, role)
 * 2. Database Operation:
 *    - Order.findById(id)
 * 3. Response Sent:
 *    - HTTP 200: Single Order JSON object (with 403 error if user lacks access)
 */
export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.userId === req.user!.id;
  const isSellerOnOrder = order.items.some((i) => i.sellerId === req.user!.id);

  if (!isOwner && !isSellerOnOrder && req.user!.role !== "admin") {
    throw ApiError.forbidden("You cannot view this order");
  }

  sendSuccess(res, order.toJSON());
});

/**
 * Controller: Get Seller's Orders
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Logged-in seller ID
 * 2. Database Operation:
 *    - Order.find({ "items.sellerId": sellerId }).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Array of orders that contain items belonging to this seller
 */
export const getSellerOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ "items.sellerId": req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json(orders);
});

/**
 * Controller: Update Order Status
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Target order ID
 *    - req.body.status: New status ("pending", "processing", "shipped", "delivered", "cancelled", etc.)
 *    - req.user: Authenticated seller or admin
 * 2. Database Operation:
 *    - Order.findById(id)
 *    - order.status = status; order.statusHistory.push(...); order.save()
 * 3. Response Sent:
 *    - HTTP 200: Updated order object with "Order status updated" message
 */
export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: string };
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isSellerOnOrder = order.items.some((i) => i.sellerId === req.user!.id);
  if (req.user!.role !== "admin" && !isSellerOnOrder) {
    throw ApiError.forbidden("You cannot update this order");
  }

  order.status = status as typeof order.status;
  order.statusHistory.push({ status: order.status, at: new Date() });

  if (status === "delivered") {
    order.paymentStatus = "paid";
    if (order.paymentMethod === "cod" || order.paymentMethod === "cash_on_delivery") {
      await PaymentRecord.findOneAndUpdate(
        { orderId: order._id.toString(), method: "cash_on_delivery" },
        { status: "successful" }
      ).catch((err) => console.error("Failed to update COD payment record to successful:", err));
    }
  }

  await order.save();
  sendSuccess(res, order.toJSON(), "Order status updated");
});

/**
 * Controller: List All Orders For Admin
 *
 * 1. Inputs Extracted:
 *    - req.query.status: Optional status filter ("pending", "delivered", etc.)
 * 2. Database Operation:
 *    - Order.find(filter).sort({ createdAt: -1 }).limit(500)
 * 3. Response Sent:
 *    - HTTP 200: Array of all orders matching the optional status filter
 */
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
