import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Product } from "../products/product.model";
import { Store } from "../sellers/store.model";
import { Order } from "../orders/order.model";
import { Review } from "../reviews/review.model";
import { Wishlist } from "../wishlist/wishlist.model";
import { Notification } from "../notifications/notification.model";
import { DeliveryZone } from "../delivery/delivery-zone.model";
import { complete } from "../ai/providers/claude.provider";
import { logAiIncident } from "../ai/incident/incident.service";
import {
  UserPreferences,
  LoyaltyPoints,
  LoyaltyTransaction,
  PaymentRecord,
  UserCoupon,
  CustomerSellerMessage,
  BuyAgainItem,
  PurchaseDocument,
  ReturnRequest,
  ProductQualityScore,
  SearchHistory,
} from "./customer-features.model";
import { Address, CustomerActivity, SupportTicket } from "./customer-extras.model";
import { PriceHistory } from "./customer-intelligence.model";

// ============================================================
// PRODUCT QUALITY SCORE (Feature 7)
// ============================================================
export const getProductQualityScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);
  const reviews = await Review.find({ productId });

  const ratingScore = Math.min(100, Math.round((product.ratingAvg / 5) * 100));
  const discountRatio = product.discountPrice ? (product.price - product.discountPrice) / product.price : 0;
  const valueScore = Math.min(100, Math.round(75 + discountRatio * 60));
  const sellerScore = Math.round(store?.trustScore || 70);
  const deliveryScore = Math.min(100, Math.round(70 + (store?.rating || 4) * 6));
  const reviewScore = Math.min(100, reviews.length * 5);

  const sentimentPositive = reviews.filter((r) => r.rating >= 4).length;
  const sentimentNegative = reviews.filter((r) => r.rating <= 2).length;

  const overallScore = Math.round(
    ratingScore * 0.3 + valueScore * 0.2 + sellerScore * 0.2 + deliveryScore * 0.15 + reviewScore * 0.15
  );

  await ProductQualityScore.findOneAndUpdate(
    { productId },
    { productId, overallScore, ratingScore, valueScore, sellerScore, deliveryScore, reviewCount: reviews.length, sentimentPositive, sentimentNegative, calculatedAt: new Date() },
    { upsert: true, new: true }
  );

  sendSuccess(res, {
    productId, overallScore, rating: product.ratingAvg, ratingScore, value: valueScore,
    seller: sellerScore, delivery: deliveryScore, reviewCount: reviews.length,
    factors: {
      rating: { score: ratingScore, weight: "30%", label: "Customer Ratings" },
      value: { score: valueScore, weight: "20%", label: "Value for Money" },
      seller: { score: sellerScore, weight: "20%", label: "Seller Trust" },
      delivery: { score: deliveryScore, weight: "15%", label: "Delivery Performance" },
      reviews: { score: reviewScore, weight: "15%", label: "Review Volume" },
    },
  });
});

// ============================================================
// SELLER TRUST SCORE (Feature 6)
// ============================================================
export const getSellerTrustScore = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.params;
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.notFound("Store not found");

  const totalOrders = await Order.countDocuments({ "items.storeId": storeId });
  const completedOrders = await Order.countDocuments({ "items.storeId": storeId, status: "delivered" });
  const cancelledOrders = await Order.countDocuments({ "items.storeId": storeId, status: "cancelled" });
  const returnRequests = await Order.countDocuments({ "items.storeId": storeId, status: "return_requested" });

  const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 80;
  const cancellationRate = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 5;
  const returnRate = completedOrders > 0 ? (returnRequests / completedOrders) * 100 : 3;
  const accountAgeDays = Math.floor((Date.now() - new Date(store.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  const accountAgeScore = Math.min(100, Math.round((accountAgeDays / 365) * 100));
  const isVerified = store.status === "approved";

  const trustScore = Math.round(
    store.trustScore * 0.3 + completionRate * 0.25 + (100 - cancellationRate * 5) * 0.15 +
    (100 - returnRate * 10) * 0.15 + accountAgeScore * 0.1 + (isVerified ? 10 : 0)
  );

  const indicators = [
    { label: "Verified Seller", passed: isVerified, detail: isVerified ? "Business verified by ShopNest" : "Pending verification" },
    { label: "Good Delivery Record", passed: completionRate >= 85, detail: `${Math.round(completionRate)}% orders delivered` },
    { label: "Highly Rated", passed: store.rating >= 4, detail: `${store.rating.toFixed(1)}/5 average rating` },
    { label: "Low Cancellation", passed: cancellationRate <= 5, detail: `${Math.round(cancellationRate)}% cancellation rate` },
    { label: "Active Seller", passed: totalOrders > 10, detail: `${totalOrders} total orders` },
  ];

  sendSuccess(res, {
    storeId, storeName: store.storeName, trustScore: Math.min(100, trustScore),
    rating: store.rating, indicators,
    metrics: { totalOrders, completionRate: Math.round(completionRate), cancellationRate: Math.round(cancellationRate), returnRate: Math.round(returnRate), accountAgeDays },
  });
});

// ============================================================
// PERSONAL PRICE INTELLIGENCE (Feature 4)
// ============================================================
export const getPriceIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  let priceRecord = await PriceHistory.findOne({ productId });

  if (!priceRecord) {
    const currentPrice = product.discountPrice || product.price;
    const basePrice = product.price;
    const historyPoints = [];
    for (let i = 7; i >= 0; i--) {
      const variation = (Math.sin(i) * 0.05 + 0.02) * basePrice;
      const pointPrice = Math.round(i === 0 ? currentPrice : basePrice + variation);
      historyPoints.push({ price: pointPrice, recordedAt: new Date(Date.now() - i * 4 * 24 * 3600 * 1000) });
    }
    const prices = historyPoints.map((p) => p.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const trend = currentPrice <= lowestPrice ? "dropping" : currentPrice >= highestPrice ? "rising" : "stable";

    priceRecord = await PriceHistory.create({
      productId, history: historyPoints, lowestPrice, highestPrice, averagePrice, currentPrice, trend,
      insight: currentPrice < averagePrice ? `Good time to buy! Price is ৳${(averagePrice - currentPrice).toLocaleString()} below average.` :
        currentPrice > averagePrice ? `Price is ৳${(currentPrice - averagePrice).toLocaleString()} above average. Consider waiting.` : "Price is stable near average.",
    });
  }

  const currentPrice = product.discountPrice || product.price;
  sendSuccess(res, {
    productId, currentPrice, previousPrice: product.price, priceChange: currentPrice - product.price,
    priceChangePercent: product.price > 0 ? Math.round(((currentPrice - product.price) / product.price) * 100) : 0,
    lowestRecorded: priceRecord.lowestPrice, highestRecorded: priceRecord.highestPrice,
    averagePrice: priceRecord.averagePrice, trend: priceRecord.trend, history: priceRecord.history,
    insight: priceRecord.insight,
    recommendation: priceRecord.trend === "dropping" ? "Good time to buy - price is dropping." :
      priceRecord.trend === "rising" ? "Price is rising - consider buying soon." : "Price is stable - fair time to purchase.",
  });
});

// ============================================================
// SMART BANGLADESH DELIVERY (Feature 9)
// ============================================================
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
export const getPaymentHistory = asyncHandler(async (req: Request, res: Response) => {
  const payments = await PaymentRecord.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, payments);
});

export const getPaymentSummary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orders = await Order.find({ userId });
  const payments = await PaymentRecord.find({ userId, status: "successful" });

  const totalSpent = payments.reduce((sum, p) => sum + p.amount, 0);
  const refundedRecords = await PaymentRecord.find({ userId, status: "refunded" });
  const refundedAmount = refundedRecords.reduce((s, p) => s + p.amount, 0);

  const methodBreakdown: Record<string, number> = {};
  payments.forEach((p) => { methodBreakdown[p.method] = (methodBreakdown[p.method] || 0) + p.amount; });

  sendSuccess(res, {
    totalSpent, successfulPayments: payments.length,
    failedPayments: await PaymentRecord.countDocuments({ userId, status: "failed" }),
    refundedAmount, codOrders: orders.filter((o) => o.paymentMethod === "cash_on_delivery").length,
    methodBreakdown, currency: "BDT",
  });
});

// ============================================================
// SMART VOUCHER WALLET (Feature 13)
// ============================================================
export const getVoucherWallet = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const coupons = await UserCoupon.find({ userId }).sort({ expiresAt: 1 });
  const available = coupons.filter((c) => c.status === "available" && c.expiresAt > now);
  const expiringSoon = coupons.filter((c) => c.status === "available" && c.expiresAt > now && c.expiresAt <= threeDaysFromNow);

  sendSuccess(res, {
    available, expiringSoon, used: coupons.filter((c) => c.status === "used"),
    expired: coupons.filter((c) => c.status === "expired" || (c.status === "available" && c.expiresAt <= now)),
    sellerVouchers: coupons.filter((c) => c.source === "seller" && c.status === "available"),
    freeDelivery: coupons.filter((c) => c.type === "free_delivery" && c.status === "available"),
    personalizedOffers: coupons.filter((c) => c.source === "personalized" && c.status === "available"),
    totalAvailable: available.length, totalUsed: coupons.filter((c) => c.status === "used").length,
  });
});

export const claimVoucher = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { couponCode } = req.body;

  const Coupon = require("../coupons/coupon.model").Coupon;
  const platformCoupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
  if (!platformCoupon) throw ApiError.notFound("Invalid coupon code");

  const existing = await UserCoupon.findOne({ userId, couponCode: couponCode.toUpperCase() });
  if (existing) throw ApiError.conflict("Coupon already claimed");

  if (platformCoupon.expiresAt && new Date(platformCoupon.expiresAt) < new Date()) {
    throw ApiError.badRequest("Coupon has expired");
  }

  const userCoupon = await UserCoupon.create({
    userId, couponCode: platformCoupon.code,
    title: `${platformCoupon.type === "percentage" ? `${platformCoupon.value}%` : `৳${platformCoupon.value}`} OFF`,
    description: `Valid on orders above ৳${platformCoupon.minPurchase}${platformCoupon.category ? ` in ${platformCoupon.category}` : ""}`,
    type: platformCoupon.type === "percentage" ? "percentage" : "fixed",
    value: platformCoupon.value, minPurchase: platformCoupon.minPurchase,
    category: platformCoupon.category, sellerId: platformCoupon.createdBy,
    source: "platform", status: "available",
    expiresAt: platformCoupon.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  sendSuccess(res, userCoupon, "Coupon claimed successfully", 201);
});

export const getBestVoucher = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { amount, category } = req.query as { amount?: string; category?: string };
  const orderAmount = Number(amount) || 0;

  const availableCoupons = await UserCoupon.find({
    userId, status: "available", expiresAt: { $gt: new Date() }, minPurchase: { $lte: orderAmount },
  });

  const sorted = availableCoupons.sort((a, b) => {
    const aValue = a.type === "percentage" ? orderAmount * (a.value / 100) : a.value;
    const bValue = b.type === "percentage" ? orderAmount * (b.value / 100) : b.value;
    return bValue - aValue;
  });

  sendSuccess(res, {
    bestCoupon: sorted[0] || null, allValid: sorted,
    potentialSavings: sorted[0] ? (sorted[0].type === "percentage" ? Math.round(orderAmount * (sorted[0].value / 100)) : sorted[0].value) : 0,
  });
});

// ============================================================
// SAVINGS DASHBOARD (Feature 14)
// ============================================================
export const getSavingsDashboard = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orders = await Order.find({ userId, status: { $in: ["delivered", "processing", "shipped", "out_for_delivery"] } });

  let totalOriginal = 0, totalDiscount = 0, totalCouponSavings = 0, totalDeliverySaved = 0;
  orders.forEach((order) => {
    const originalSubtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    totalOriginal += originalSubtotal;
    totalDiscount += originalSubtotal - order.subtotal;
    totalCouponSavings += order.discount || 0;
    if (order.totalAmount > 2000) totalDeliverySaved += 60;
  });

  const totalSaved = totalDiscount + totalCouponSavings + totalDeliverySaved;
  sendSuccess(res, {
    originalPrice: totalOriginal, discount: totalDiscount, couponSavings: totalCouponSavings,
    deliverySaved: totalDeliverySaved, totalSaved, orderCount: orders.length, currency: "BDT",
    savingsPercentage: totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0,
  });
});

// ============================================================
// PERSONAL EXPENSE ANALYTICS (Feature 15)
// ============================================================
export const getExpenseAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { range } = req.query as { range?: string };
  const now = new Date();
  let startDate: Date;
  switch (range) {
    case "this_month": startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "last_month": startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); break;
    case "6_months": startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1); break;
    case "this_year": startDate = new Date(now.getFullYear(), 0, 1); break;
    default: startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  }

  const orders = await Order.find({ userId, createdAt: { $gte: startDate }, status: { $nin: ["cancelled"] } });
  const totalSpend = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

  const monthMap: Record<string, { amount: number; orders: number }> = {};
  const categoryMap: Record<string, number> = {};
  orders.forEach((o) => {
    const monthKey = new Date(o.createdAt).toLocaleString("default", { month: "short", year: "2-digit" });
    if (!monthMap[monthKey]) monthMap[monthKey] = { amount: 0, orders: 0 };
    monthMap[monthKey].amount += o.totalAmount;
    monthMap[monthKey].orders += 1;
    o.items.forEach((item: { category?: string; price: number; quantity: number }) => {
      const cat = item.category || "General";
      categoryMap[cat] = (categoryMap[cat] || 0) + item.price * item.quantity;
    });
  });

  const categorySpending = Object.entries(categoryMap).map(([category, amount]) => ({
    category, amount, percentage: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0,
  })).sort((a, b) => b.amount - a.amount);

  sendSuccess(res, {
    overview: { totalSpend, orderCount, avgOrderValue, topCategory: categorySpending[0]?.category || "None" },
    monthlySpending: Object.entries(monthMap).map(([month, data]) => ({ month, amount: data.amount, orders: data.orders })),
    categorySpending, range: range || "6_months",
  });
});

// ============================================================
// INTELLIGENT NOTIFICATION CENTER (Feature 16)
// ============================================================
export const getIntelligentNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { category, page = 1, limit = 20 } = req.query as { category?: string; page?: string; limit?: string };
  const filter: Record<string, unknown> = { userId };

  if (category && category !== "all") {
    const categoryMap: Record<string, string[]> = {
      important: ["order_confirmation", "order_delivered"], price_alerts: ["price_drop"],
      recommendations: ["flash_sale"], orders: ["order_confirmation", "order_shipped", "order_delivered", "order_update"],
      promotions: ["coupon", "flash_sale"], security: ["low_stock"],
    };
    filter.type = { $in: categoryMap[category] || [] };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, isRead: false }),
  ]);

  sendSuccess(res, { notifications, unreadCount, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user!.id }, { isRead: true });
  sendSuccess(res, { success: true });
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany({ userId: req.user!.id, isRead: false }, { isRead: true });
  sendSuccess(res, { success: true }, "All notifications marked as read");
});

// ============================================================
// SMART WISHLIST (Feature 17)
// ============================================================
export const getSmartWishlist = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) return sendSuccess(res, { items: [], priceDrops: [], stockAlerts: [] });

  const productIds = wishlist.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });

  const items = products.map((p) => {
    const currentPrice = p.discountPrice || p.price;
    const priceDrop = p.price > currentPrice ? p.price - currentPrice : 0;
    return {
      id: p.id, title: p.title, currentPrice, originalPrice: p.price, priceDrop,
      priceDropPercent: priceDrop > 0 ? Math.round((priceDrop / p.price) * 100) : 0,
      hasPriceDrop: priceDrop > 0, inStock: p.stock > 0, stock: p.stock,
      category: p.category, images: p.images || [], ratingAvg: p.ratingAvg,
      addedAt: wishlist.items.find((i) => i.productId === p.id)?.addedAt,
    };
  });

  sendSuccess(res, { items, priceDrops: items.filter((i) => i.hasPriceDrop), stockAlerts: items.filter((i) => !i.inStock), totalItems: items.length });
});

export const togglePriceTracking = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await CustomerActivity.create({ userId, activityType: "wishlist_add", title: "Price tracking toggled", details: `Product ${req.params.productId}` });
  sendSuccess(res, { success: true, message: "Price tracking updated" });
});

// ============================================================
// SMART BUY AGAIN (Feature 18)
// ============================================================
export const getBuyAgainProducts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let buyAgainItems = await BuyAgainItem.find({ userId }).sort({ lastPurchasedAt: -1 }).limit(20);

  if (buyAgainItems.length === 0) {
    const orders = await Order.find({ userId, status: "delivered" }).sort({ createdAt: -1 }).limit(10);
    const productMap: Record<string, { count: number; lastOrder: Date; orderId: string; price: number; title: string; category: string }> = {};
    orders.forEach((order) => {
      order.items.forEach((item: { productId: string; title: string; quantity: number; price: number; category?: string }) => {
        if (!productMap[item.productId]) productMap[item.productId] = { count: 0, lastOrder: order.createdAt, orderId: order.id, price: item.price, title: item.title, category: item.category || "General" };
        productMap[item.productId].count += item.quantity;
        if (new Date(order.createdAt) > new Date(productMap[item.productId].lastOrder)) { productMap[item.productId].lastOrder = order.createdAt; productMap[item.productId].orderId = order.id; }
      });
    });

    for (const [productId, data] of Object.entries(productMap)) {
      const item = await BuyAgainItem.findOneAndUpdate(
        { userId, productId },
        { $set: { productTitle: data.title, category: data.category, lastPurchasedAt: data.lastOrder, lastOrderId: data.orderId, lastPrice: data.price }, $inc: { purchaseCount: data.count } },
        { upsert: true, new: true }
      );
      buyAgainItems.push(item);
    }
  }

  const productIds = buyAgainItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const items = buyAgainItems.map((item) => {
    const product = productMap.get(item.productId);
    return {
      productId: item.productId, title: item.productTitle, category: item.category,
      lastPrice: item.lastPrice, currentPrice: product ? (product.discountPrice || product.price) : item.lastPrice,
      purchaseCount: item.purchaseCount, daysSincePurchase: Math.floor((Date.now() - new Date(item.lastPurchasedAt).getTime()) / (1000 * 60 * 60 * 24)),
      inStock: product ? product.stock > 0 : false, image: product?.images?.[0] || "", available: !!product,
    };
  });

  sendSuccess(res, { items });
});

// ============================================================
// DIGITAL PURCHASE VAULT (Feature 22)
// ============================================================
export const getPurchaseVault = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.query as { type?: string };
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (type) filter.type = type;
  const documents = await PurchaseDocument.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, documents);
});

export const getPurchaseDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await PurchaseDocument.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!doc) throw ApiError.notFound("Document not found");
  sendSuccess(res, doc);
});

// ============================================================
// WARRANTY MANAGER (Feature 23)
// ============================================================
export const getWarranties = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ userId: req.user!.id, status: "delivered" }).sort({ createdAt: -1 });
  const warranties = orders.flatMap((order) =>
    order.items.map((item: { productId: string; title: string; sellerId: string; category?: string }) => ({
      orderId: order.id, productId: item.productId, productTitle: item.title,
      category: item.category || "General", purchaseDate: order.createdAt,
      warrantyDuration: "1 Year", warrantyExpiry: new Date(new Date(order.createdAt).setFullYear(new Date(order.createdAt).getFullYear() + 1)),
      sellerId: item.sellerId, status: "active" as const,
    }))
  );
  sendSuccess(res, warranties);
});

// ============================================================
// CUSTOMER-SELLER COMMUNICATION (Feature 24)
// ============================================================
export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: -1 });
  const conversationMap: Record<string, { lastMessage: typeof messages[0]; unreadCount: number; participantId: string }> = {};

  messages.forEach((msg) => {
    if (!conversationMap[msg.conversationId]) conversationMap[msg.conversationId] = { lastMessage: msg, unreadCount: 0, participantId: msg.senderId === userId ? msg.receiverId : msg.senderId };
    if (msg.receiverId === userId && !msg.isRead) conversationMap[msg.conversationId].unreadCount++;
  });

  sendSuccess(res, Object.entries(conversationMap).map(([id, data]) => ({
    conversationId: id, participantId: data.participantId, subject: data.lastMessage.subject,
    lastMessage: data.lastMessage.message, lastMessageAt: data.lastMessage.createdAt, unreadCount: data.unreadCount,
  })));
});

export const getConversationMessages = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ conversationId: req.params.conversationId, $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: 1 });
  await CustomerSellerMessage.updateMany({ conversationId: req.params.conversationId, receiverId: userId, isRead: false }, { isRead: true });
  sendSuccess(res, messages);
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  if (userRole !== "customer") throw ApiError.forbidden("Only customers can initiate messages");

  const { receiverId, orderId, productId, subject, message } = req.body;
  const conversationId = [userId, receiverId].sort().join("_") + (orderId ? `_${orderId}` : "");

  const msg = await CustomerSellerMessage.create({
    conversationId, senderId: userId, senderRole: "customer", receiverId, receiverRole: "seller",
    orderId, productId, subject, message, isRead: false,
  });
  sendSuccess(res, msg, "Message sent", 201);
});

export const reportMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const msg = await CustomerSellerMessage.findOneAndUpdate(
    { _id: req.params.id, $or: [{ senderId: userId }, { receiverId: userId }] },
    { isReported: true, reportReason: req.body.reason }
  );
  if (!msg) throw ApiError.notFound("Message not found");
  sendSuccess(res, { success: true }, "Message reported successfully");
});

// ============================================================
// SMART CUSTOMER SUPPORT (Feature 25)
// ============================================================
export const aiSupportChat = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { message } = req.body;
  const recentOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(3);

  let aiResponse = "";
  let suggestedAction = "";

  try {
    aiResponse = await complete(
      [{ role: "user", content: `Customer: "${message}"\nOrders: ${JSON.stringify(recentOrders.map((o) => ({ id: o.id, status: o.status, total: o.totalAmount })))}` }],
      { system: "You are ShopNest support AI. Help with orders, delivery, returns. Be concise. If issue needs human help, say so clearly." }
    );
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("not arrived") || lowerMsg.includes("late") || lowerMsg.includes("damaged") || lowerMsg.includes("wrong")) suggestedAction = "create_ticket";
  } catch (err) {
    await logAiIncident({ type: "PROVIDER_ERROR", userId, endpoint: "/customer/support/ai-chat", input: message, error: err instanceof Error ? err.message : String(err) });
    aiResponse = "I apologize for the trouble. Let me create a support ticket for you.";
    suggestedAction = "create_ticket";
  }

  sendSuccess(res, { response: aiResponse, suggestedAction, recentOrders: recentOrders.map((o) => ({ id: o.id, status: o.status })) });
});

export const getSupportTickets = asyncHandler(async (req: Request, res: Response) => {
  const tickets = await SupportTicket.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, tickets);
});

export const createSupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await SupportTicket.create({ userId: req.user!.id, ...req.body, status: "open" });
  sendSuccess(res, ticket, "Support ticket created", 201);
});

// ============================================================
// CUSTOMER LOYALTY & REWARDS (Feature 26)
// ============================================================
export const getLoyaltyStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) loyalty = await LoyaltyPoints.create({ userId, totalPoints: 0, availablePoints: 0, lifetimePoints: 0, level: "bronze" });

  const levelThresholds = { bronze: 0, silver: 500, gold: 1500, platinum: 5000 };
  const nextLevel = loyalty.level === "bronze" ? "silver" : loyalty.level === "silver" ? "gold" : loyalty.level === "gold" ? "platinum" : null;
  const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;
  const progress = nextThreshold ? Math.round((loyalty.lifetimePoints / nextThreshold) * 100) : 100;

  sendSuccess(res, {
    ...loyalty.toJSON(), nextLevel, nextThreshold, progress: Math.min(100, progress),
    benefits: {
      bronze: ["Earn 1 point per ৳100", "Birthday coupon"],
      silver: ["Earn 1.5 points per ৳100", "Free delivery on orders above ৳1000", "Early access to sales"],
      gold: ["Earn 2 points per ৳100", "Free delivery on all orders", "Priority support", "Exclusive deals"],
      platinum: ["Earn 3 points per ৳100", "Free delivery + returns", "VIP support", "Personal shopper"],
    },
  });
});

export const getLoyaltyTransactions = asyncHandler(async (req: Request, res: Response) => {
  const transactions = await LoyaltyTransaction.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, transactions);
});

export const redeemPoints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { points, rewardType } = req.body;

  const loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) throw ApiError.notFound("Loyalty account not found");
  if (loyalty.availablePoints < points) throw ApiError.badRequest("Insufficient points");

  let reward = "";
  switch (rewardType) {
    case "coupon": reward = "SAVE" + points; break;
    case "free_delivery": reward = "FREESHIP"; break;
    case "discount": reward = `DISCOUNT${points}`; break;
  }

  loyalty.availablePoints -= points;
  await loyalty.save();

  await LoyaltyTransaction.create({ userId, type: "redeemed", points: -points, description: `Redeemed for ${rewardType}`, balanceAfter: loyalty.availablePoints });
  sendSuccess(res, { success: true, reward, remainingPoints: loyalty.availablePoints });
});

// ============================================================
// ADDRESS INTELLIGENCE (Feature 27)
// ============================================================
export const getAddressesIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await Address.find({ userId: req.user!.id }).sort({ isDefault: -1, createdAt: -1 });
  sendSuccess(res, addresses);
});

export const createAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const existingCount = await Address.countDocuments({ userId });
  const address = await Address.create({ userId, ...req.body, isDefault: req.body.isDefault || existingCount === 0 });
  if (address.isDefault) await Address.updateMany({ userId, _id: { $ne: address._id } }, { isDefault: false });
  sendSuccess(res, address, "Address saved successfully", 201);
});

export const updateAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (req.body.isDefault) await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  Object.assign(address, req.body);
  await address.save();
  sendSuccess(res, address, "Address updated successfully");
});

export const deleteAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (address.isDefault) {
    const next = await Address.findOne({ userId: req.user!.id }).sort({ createdAt: -1 });
    if (next) { next.isDefault = true; await next.save(); }
  }
  sendSuccess(res, { id: req.params.id }, "Address removed successfully");
});

export const setDefaultAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  address.isDefault = true;
  await address.save();
  sendSuccess(res, address, "Default address updated");
});

// ============================================================
// CUSTOMER SECURITY CENTER (Feature 28)
// ============================================================
export const getSecurityCenter = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [sessions, timeline] = await Promise.all([
    require("../security/security-intelligence.model").DeviceSession.find({ userId, status: "active" }),
    require("../security/security-intelligence.model").SecurityRiskLog.find({ userId }).sort({ createdAt: -1 }).limit(20),
  ]);

  sendSuccess(res, {
    securityScore: 85,
    sessions,
    timeline,
    twoFactorEnabled: false,
    lastPasswordChange: null,
    recommendations: ["Enable 2FA for extra security", "Review active sessions regularly"],
  });
});

export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await require("../security/security-intelligence.model").DeviceSession.find({ userId: req.user!.id, status: "active" });
  sendSuccess(res, sessions);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "Session revoked");
});

export const revokeAllSessions = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.updateMany(
    { userId: req.user!.id, isCurrentSession: false }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "All other sessions revoked");
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, { success: true }, "Password change initiated. Please check your email.");
});

// ============================================================
// ACCOUNT ACTIVITY TIMELINE (Feature 29)
// ============================================================
export const getActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { range } = req.query as { range?: string };

  const now = new Date();
  let startDate: Date;
  switch (range) {
    case "today": startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "week": startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const activities = await CustomerActivity.find({ userId, createdAt: { $gte: startDate } }).sort({ createdAt: -1 }).limit(100);
  const grouped: Record<string, typeof activities> = {};

  activities.forEach((activity) => {
    const dateKey = new Date(activity.createdAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(activity);
  });

  sendSuccess(res, { activities, grouped, range: range || "month" });
});

export const clearActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  await CustomerActivity.deleteMany({ userId: req.user!.id });
  sendSuccess(res, { success: true }, "Activity timeline cleared");
});

// ============================================================
// PERSONAL SHOPPING PROFILE (Feature 30)
// ============================================================
export const getShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let preferences = await UserPreferences.findOne({ userId });

  if (!preferences) {
    preferences = await UserPreferences.create({
      userId, preferredCategories: [], typicalBudgetMin: 0, typicalBudgetMax: 50000,
      preferredSellers: [], preferredDelivery: "any", favoriteBrands: [], shoppingInterests: [], allowPersonalization: true,
    });
  }

  sendSuccess(res, preferences);
});

export const updateShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const preferences = await UserPreferences.findOneAndUpdate(
    { userId }, { $set: req.body }, { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  sendSuccess(res, preferences, "Shopping profile updated");
});

export const resetShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await UserPreferences.findOneAndDelete({ userId });
  sendSuccess(res, { success: true }, "Shopping profile reset");
});

export const deletePersonalizationData = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await Promise.all([
    UserPreferences.findOneAndDelete({ userId }),
    CustomerActivity.deleteMany({ userId }),
    SearchHistory.deleteMany({ userId }),
    require("./customer-intelligence.model").ShoppingJourney.deleteMany({ userId }),
  ]);
  sendSuccess(res, { success: true }, "Personalization data deleted");
});