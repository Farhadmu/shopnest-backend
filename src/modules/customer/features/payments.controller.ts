import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";
import { PaymentRecord } from "../customer-features.model";

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
