import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Order } from "../../orders/order.model";
import { UserCoupon } from "../customer-features.model";

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
// SMART WISHLIST (Feature 17)
// ============================================================
