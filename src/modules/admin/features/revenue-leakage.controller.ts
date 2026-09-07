import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";

export const getRevenueLeakage = asyncHandler(async (_req: Request, res: Response) => {
  const allOrders = await Order.find({});
  const totalRevenue = allOrders
    .filter((o) => ["delivered", "shipped", "out_for_delivery", "processing", "confirmed"].includes(o.status))
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const cancelledOrders = allOrders.filter((o) => o.status === "cancelled");
  const refundedOrders = allOrders.filter((o) => o.status === "refunded" || o.status === "returned");

  const cancelledValue = cancelledOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const refundValue = refundedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const totalDiscount = allOrders.reduce((sum, o) => sum + (o.discount || 0), 0);

  const couponOrders = allOrders.filter((o) => o.couponCode);
  const couponImpact = couponOrders.reduce((sum, o) => sum + (o.discount || 0), 0);

  const unpaidOrders = allOrders.filter((o) => o.paymentStatus === "unpaid" && o.status !== "cancelled");
  const unpaidValue = unpaidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const totalPotentialLeakage = cancelledValue + refundValue + unpaidValue;

  const leakageCategories = [];

  if (cancelledValue > 0) {
    leakageCategories.push({
      type: "Cancelled Orders",
      amount: cancelledValue,
      count: cancelledOrders.length,
      severity: cancelledValue > totalRevenue * 0.1 ? "high" : cancelledValue > totalRevenue * 0.05 ? "medium" : "low",
      details: `${cancelledOrders.length} cancelled orders totaling ৳${cancelledValue.toLocaleString()}`,
    });
  }

  if (refundValue > 0) {
    leakageCategories.push({
      type: "Refunded/Returned Orders",
      amount: refundValue,
      count: refundedOrders.length,
      severity: refundValue > totalRevenue * 0.1 ? "high" : refundValue > totalRevenue * 0.05 ? "medium" : "low",
      details: `${refundedOrders.length} refunded/returned orders totaling ৳${refundValue.toLocaleString()}`,
    });
  }

  if (unpaidValue > 0) {
    leakageCategories.push({
      type: "Unpaid Orders",
      amount: unpaidValue,
      count: unpaidOrders.length,
      severity: "medium",
      details: `${unpaidOrders.length} unpaid orders totaling ৳${unpaidValue.toLocaleString()}`,
    });
  }

  if (totalDiscount > 0) {
    leakageCategories.push({
      type: "Discount Impact",
      amount: totalDiscount,
      count: allOrders.filter((o) => (o.discount || 0) > 0).length,
      severity: totalDiscount > totalRevenue * 0.2 ? "high" : totalDiscount > totalRevenue * 0.1 ? "medium" : "low",
      details: `Total discounts given: ৳${totalDiscount.toLocaleString()}`,
    });
  }

  if (couponImpact > 0) {
    leakageCategories.push({
      type: "Coupon Impact",
      amount: couponImpact,
      count: couponOrders.length,
      severity: couponImpact > totalRevenue * 0.15 ? "high" : couponImpact > totalRevenue * 0.05 ? "medium" : "low",
      details: `${couponOrders.length} orders used coupons totaling ৳${couponImpact.toLocaleString()}`,
    });
  }

  if (leakageCategories.length === 0) {
    leakageCategories.push({
      type: "No Leakage Detected",
      amount: 0,
      count: 0,
      severity: "low",
      details: "No financial leakage detected from the currently available transaction data.",
    });
  }

  sendSuccess(res, {
    totalRevenue,
    totalPotentialLeakage,
    leakageFormatted: `৳${totalPotentialLeakage.toLocaleString()}`,
    leakagePercentage: totalRevenue > 0 ? Math.round((totalPotentialLeakage / totalRevenue) * 100) : 0,
    recoveredThisMonth: "৳0",
    leakageCategories,
    orderSummary: {
      total: allOrders.length,
      completed: allOrders.filter((o) => o.status === "delivered").length,
      cancelled: cancelledOrders.length,
      refunded: refundedOrders.length,
    },
    automatedRemediation: totalPotentialLeakage > 0
      ? "Review flagged transactions and verify refund/cancellation legitimacy."
      : "No automated remediation required. All transactions appear normal.",
  });
});

// 32. SELLER RISK RANKING