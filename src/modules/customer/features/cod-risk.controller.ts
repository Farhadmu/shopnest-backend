import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";

export const getCODOrderRisk = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderAmount = 0 } = req.query as { orderAmount?: string };

  const totalOrders = await Order.countDocuments({ customerId: userId });
  const deliveredOrders = await Order.countDocuments({ customerId: userId, status: "delivered" });
  const cancelledOrders = await Order.countDocuments({ customerId: userId, status: "cancelled" });
  const returnedOrders = await Order.countDocuments({ customerId: userId, status: { $in: ["returned", "return_requested"] } });

  let riskScore = 15; // default baseline low risk
  const amount = Number(orderAmount) || 0;

  if (totalOrders === 0) {
    riskScore = amount > 15000 ? 55 : 30; // first time high order is medium risk
  } else {
    const cancelRate = cancelledOrders / totalOrders;
    const returnRate = returnedOrders / totalOrders;
    riskScore += Math.round(cancelRate * 50);
    riskScore += Math.round(returnRate * 35);
    if (deliveredOrders >= 3) riskScore -= 20;
    if (deliveredOrders >= 10) riskScore -= 15;
  }

  riskScore = Math.max(5, Math.min(95, riskScore));

  let riskLevel: "LOW RISK" | "MEDIUM RISK" | "HIGH RISK" = "LOW RISK";
  if (riskScore > 65) riskLevel = "HIGH RISK";
  else if (riskScore > 35) riskLevel = "MEDIUM RISK";

  sendSuccess(res, {
    riskLevel,
    riskScore,
    stats: {
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      fulfillmentRatio: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 100,
    },
    recommendation:
      riskLevel === "LOW RISK"
        ? "Eligible for 1-Click Cash on Delivery."
        : riskLevel === "MEDIUM RISK"
        ? "Standard COD allowed with SMS confirmation."
        : "High risk profile detected. Pre-payment or OTP verification recommended.",
  });
});

// ============================================================
// RETURN ELIGIBILITY (kept - no equivalent exists in returns/return-eligibility module,
// which requires BOTH :orderId AND :productId, not a whole-order-level check)
// ============================================================
