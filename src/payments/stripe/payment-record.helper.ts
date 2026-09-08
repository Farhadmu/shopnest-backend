import Stripe from "stripe";
import { Order } from "../../modules/orders/order.model";
import { PaymentRecord } from "../../modules/customer/customer-features.model";

/**
 * Shared helper to handle successful Stripe payment.
 * Used by both Stripe Webhook and Client Verify endpoint.
 * Idempotent: safe to run multiple times for the same session.
 */
export async function handleStripePaymentSuccess(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    throw new Error("Order ID is missing from Stripe session metadata");
  }

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

  // Resolve transaction ID (payment_intent if present, fallback to session.id)
  const txId =
    (typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as { id?: string } | null)?.id) || session.id;

  // 2. Upsert PaymentRecord idempotently into MongoDB
  const paymentRecord = await PaymentRecord.findOneAndUpdate(
    { orderId: order._id.toString(), transactionId: txId },
    {
      userId: order.userId,
      orderId: order._id.toString(),
      amount: order.totalAmount,
      method: "card",
      status: "successful",
      transactionId: txId,
      description: `Stripe card payment for Order #${order._id.toString().slice(-6).toUpperCase()}`,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { order, paymentRecord };
}
