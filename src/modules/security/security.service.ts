import { SecurityLog, SecurityEventType, SecuritySeverity } from "./securityLog.model";
import { Order } from "../orders/order.model";
import { logger } from "../../utils/logger";

export async function logSecurityEvent(
  type: SecurityEventType,
  message: string,
  opts: { userId?: string; ip?: string; details?: unknown; severity?: SecuritySeverity } = {}
) {
  try {
    await SecurityLog.create({ type, message, ...opts, severity: opts.severity ?? "low" });
  } catch (err) {
    logger.error("Failed to write security log", err);
  }
}

/**
 * Lightweight fraud heuristics run after checkout. This is intentionally
 * simple (rule-based) rather than a full ML pipeline - it flags orders for
 * human/admin review, it never blocks checkout.
 */
export async function flagSuspiciousOrder(order: { userId: string; totalAmount: number; _id: unknown }) {
  const reasons: string[] = [];

  if (order.totalAmount > 100_000) reasons.push("Unusually high order value");

  const recentCount = await Order.countDocuments({
    userId: order.userId,
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  });
  if (recentCount >= 5) reasons.push("More than 5 orders placed in the last 10 minutes");

  if (reasons.length > 0) {
    await logSecurityEvent("SUSPICIOUS_ORDER", reasons.join("; "), {
      userId: order.userId,
      details: { orderId: order._id, totalAmount: order.totalAmount },
      severity: reasons.length > 1 ? "high" : "medium",
    });
  }
}
