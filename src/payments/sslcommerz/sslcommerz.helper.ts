import { Order } from "../../modules/orders/order.model";
import { PaymentRecord } from "../../modules/customer/customer-features.model";

/**
 * Shared helper to handle successful SSLCommerz payment.
 * Used by both SSLCommerz IPN and Client Verify endpoint.
 * Idempotent: safe to run multiple times for the same transaction.
 */
export async function handleSSLCommerzPaymentSuccess({
  orderId,
  transactionId,
  amount,
  cardType,
  bankTranId,
}: {
  orderId: string;
  transactionId?: string;
  amount?: number;
  cardType?: string;
  bankTranId?: string;
}) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // 1. Update order payment status to "paid" and confirm if pending
  if (order.paymentStatus !== "paid") {
    order.paymentStatus = "paid";
    if (order.status === "pending") {
      order.status = "confirmed";
      order.statusHistory.push({ status: "confirmed", at: new Date() });
    }
    await order.save();
  }

  // 2. Resolve transaction ID
  const txId = bankTranId || transactionId || `SHOPNEST_${order._id.toString()}`;

  // Map cardType to allowed method enum in PaymentRecord
  const ct = (cardType || "").toLowerCase();
  const paymentMethod: "card" | "mobile_banking" =
    ct.includes("bkash") ||
    ct.includes("nagad") ||
    ct.includes("rocket") ||
    ct.includes("upay") ||
    ct.includes("mobile")
      ? "mobile_banking"
      : "card";

  // 3. Upsert PaymentRecord idempotently into MongoDB
  const paymentRecord = await PaymentRecord.findOneAndUpdate(
    { orderId: order._id.toString(), transactionId: txId },
    {
      userId: order.userId,
      orderId: order._id.toString(),
      amount: amount || order.totalAmount,
      method: paymentMethod,
      status: "successful",
      transactionId: txId,
      description: `SSLCommerz payment (${cardType || "Online"}) for Order #${order._id.toString().slice(-6).toUpperCase()}`,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { order, paymentRecord };
}
