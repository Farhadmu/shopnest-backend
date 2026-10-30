import mongoose from "mongoose";
import { CustomerFraudProfile, ICustomerRiskFactor, CustomerRiskLevel, CustomerTrustGrade } from "./customer-fraud.model";
import { Order } from "../orders/order.model";
import { usersCollection, safeObjectId } from "../users/user.model";
import { logSecurityEvent } from "../security/security.service";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";

interface EvaluateOrderPayload {
  totalAmount?: number;
  paymentMethod?: string;
  shippingAddress?: string;
}

export class CustomerFraudService {
  /**
   * Evaluate customer risk profile dynamically using real order history & behavioral heuristics.
   */
  static async evaluateCustomer(userId: string, currentOrder?: EvaluateOrderPayload) {
    if (!userId) return null;

    // 1. Fetch user data from Better-Auth managed collection
    let userDoc: any = null;
    try {
      const objectId = safeObjectId(userId);
      userDoc = await usersCollection().findOne({
        $or: [{ id: userId }, ...(objectId ? [{ _id: objectId }] : [])],
      });
    } catch (err) {
      logger.warn(`Failed to fetch user doc for fraud evaluation: ${userId}`, err);
    }

    const customerName = userDoc?.name || "Customer";
    const customerEmail = userDoc?.email || "";
    const customerPhone = userDoc?.phone || userDoc?.phoneNumber || "";
    const avatarUrl = userDoc?.image || "";
    const isUserBanned = Boolean(userDoc?.banned);

    // 2. Fetch all orders for this customer
    const orders = await Order.find({
      $or: [{ userId }, { customerId: userId } as any],
    }).sort({ createdAt: -1 });

    const totalOrders = orders.length;
    const deliveredOrders = orders.filter((o) => o.status === "delivered").length;
    const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
    const returnedOrders = orders.filter((o) => ["returned", "refunded"].includes(o.status)).length;
    const refundedOrders = orders.filter((o) => o.paymentStatus === "refunded" || o.status === "refunded").length;

    const totalSpent = orders
      .filter((o) => o.status !== "cancelled")
      .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

    const completedDeliveries = deliveredOrders + returnedOrders;
    const rtoRate = completedDeliveries > 0
      ? Math.round((returnedOrders / completedDeliveries) * 100)
      : (returnedOrders > 0 ? 100 : 0);

    const cancellationRate = totalOrders > 0
      ? Math.round((cancelledOrders / totalOrders) * 100)
      : 0;

    const fulfillmentRate = totalOrders > 0
      ? Math.round((deliveredOrders / totalOrders) * 100)
      : 100;

    // 3. Compute Rule-Based Risk Factors
    let score = 10; // Baseline score
    const factors: ICustomerRiskFactor[] = [];
    const tags: string[] = [];

    // --- RTO / Parcel Delivery Refusal Risk ---
    if (returnedOrders >= 2 && rtoRate >= 25) {
      score += 40;
      factors.push({
        code: "EXCESSIVE_RTO",
        name: "Excessive Parcel Return / Refusal (RTO)",
        description: `Customer refused or returned ${returnedOrders} parcels (${rtoRate}% RTO rate)`,
        weight: 40,
        severity: "critical",
      });
      tags.push("rto_abuser");
    } else if (returnedOrders >= 1) {
      score += 20;
      factors.push({
        code: "RTO_HISTORY",
        name: "Parcel Return Record",
        description: `Has ${returnedOrders} returned or refunded delivery in history`,
        weight: 20,
        severity: "medium",
      });
    }

    // --- Cancellation Risk ---
    if (totalOrders >= 3 && cancellationRate >= 50) {
      score += 25;
      factors.push({
        code: "HIGH_CANCELLATION",
        name: "Chronic Order Cancellation Pattern",
        description: `${cancellationRate}% of orders cancelled (${cancelledOrders} out of ${totalOrders})`,
        weight: 25,
        severity: "high",
      });
      tags.push("chronic_canceller");
    }

    // --- Order Velocity Risk ---
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentOrders = orders.filter((o) => o.createdAt && new Date(o.createdAt) >= fifteenMinsAgo);
    if (recentOrders.length >= 3) {
      score += 30;
      factors.push({
        code: "VELOCITY_SPIKE",
        name: "High Velocity Order Burst",
        description: `${recentOrders.length} orders placed within the last 15 minutes`,
        weight: 30,
        severity: "critical",
      });
      tags.push("velocity_spike");
    }

    // --- Order Ticket Size ---
    const evalAmount = currentOrder?.totalAmount ?? orders[0]?.totalAmount ?? 0;
    if (evalAmount > 100000) {
      score += 25;
      factors.push({
        code: "HIGH_TICKET_ORDER",
        name: "Extreme Cart Value",
        description: `Order amount ৳${evalAmount.toLocaleString()} exceeds ৳100,000 threshold`,
        weight: 25,
        severity: "high",
      });
    } else if (totalOrders <= 1 && evalAmount > 50000) {
      score += 20;
      factors.push({
        code: "UNVERIFIED_HIGH_VALUE",
        name: "Unverified First-Time High Ticket",
        description: `New customer with large initial cart value (৳${evalAmount.toLocaleString()})`,
        weight: 20,
        severity: "medium",
      });
      tags.push("new_high_value");
    }

    // --- Shipping Address Anomaly ---
    const address = currentOrder?.shippingAddress || orders[0]?.shippingAddress || "";
    if (address && address.trim().length < 15) {
      score += 15;
      factors.push({
        code: "VAGUE_ADDRESS",
        name: "Ambiguous Shipping Address",
        description: `Address string is suspiciously brief ("${address.trim()}"), high courier delivery failure risk`,
        weight: 15,
        severity: "medium",
      });
    }

    // --- Trust Credits (Reward Clean Track Records) ---
    if (deliveredOrders >= 10 && returnedOrders === 0) {
      score -= 30;
      factors.push({
        code: "VIP_RELIABLE",
        name: "Prime Fulfillment Loyalty",
        description: `${deliveredOrders} successful deliveries with zero returns`,
        weight: -30,
        severity: "low",
      });
      tags.push("vip_shopper");
    } else if (deliveredOrders >= 3 && returnedOrders === 0) {
      score -= 15;
      factors.push({
        code: "VERIFIED_HISTORY",
        name: "Clean Delivery History",
        description: `${deliveredOrders} delivered orders without complaints`,
        weight: -15,
        severity: "low",
      });
      tags.push("verified_customer");
    }

    if (totalSpent > 100000 && rtoRate === 0) {
      score -= 15;
      tags.push("high_spender");
    }

    // Clamp score 0 to 100
    score = Math.max(0, Math.min(100, score));

    // Determine Risk Level & Trust Grade
    let riskLevel: CustomerRiskLevel = "low";
    let trustGrade: CustomerTrustGrade = "A";

    if (score >= 75) {
      riskLevel = "critical";
      trustGrade = "F";
    } else if (score >= 50) {
      riskLevel = "high";
      trustGrade = "D";
    } else if (score >= 30) {
      riskLevel = "medium";
      trustGrade = "C";
    } else if (score >= 15) {
      riskLevel = "low";
      trustGrade = "B";
    } else {
      riskLevel = "low";
      trustGrade = "A";
    }

    // Fetch existing profile to respect manual admin actions (blacklist/cod restrictions)
    const existing = await CustomerFraudProfile.findOne({ userId });

    let isCodRestricted = existing ? existing.isCodRestricted : false;
    let isBlacklisted = existing ? existing.isBlacklisted : isUserBanned;

    // Automatic COD Restriction Rule: If RTO rate >= 30% with >= 2 returns, or riskLevel is critical
    if (returnedOrders >= 2 && rtoRate >= 30) {
      isCodRestricted = true;
      if (!tags.includes("cod_restricted")) tags.push("cod_restricted");
    }

    if (isBlacklisted && !tags.includes("blacklisted")) {
      tags.push("blacklisted");
    }

    const lastOrderDate = orders[0]?.createdAt ? new Date(orders[0].createdAt) : undefined;

    const profileData = {
      userId,
      customerName,
      customerEmail,
      customerPhone,
      avatarUrl,
      riskScore: score,
      riskLevel,
      trustGrade,
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      refundedOrders,
      totalSpent: Math.round(totalSpent * 100) / 100,
      rtoRate,
      cancellationRate,
      fulfillmentRate,
      isCodRestricted,
      isBlacklisted,
      riskFactors: factors,
      tags: [...new Set(tags)],
      lastEvaluatedAt: new Date(),
      lastOrderAt: lastOrderDate,
    };

    const profile = await CustomerFraudProfile.findOneAndUpdate(
      { userId },
      { $set: profileData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // If critical risk newly detected, log security event
    if (riskLevel === "critical" && (!existing || existing.riskLevel !== "critical")) {
      logSecurityEvent(
        "SUSPICIOUS_ORDER",
        `High-Risk Customer detected: ${customerName} (${customerEmail}) - Risk Score: ${score}`,
        {
          userId,
          severity: "high",
          details: { factors: factors.map((f) => f.name), score, rtoRate },
        }
      ).catch(() => undefined);
    }

    return profile;
  }

  /**
   * Pre-checkout validation: Verifies if the customer is allowed to place this order
   */
  static async checkCheckoutEligibility(userId: string, paymentMethod: string, totalAmount: number) {
    if (!userId) return;

    let profile = await CustomerFraudProfile.findOne({ userId });
    if (!profile) {
      profile = await this.evaluateCustomer(userId, { paymentMethod, totalAmount });
    }

    if (!profile) return;

    // 1. Account Blacklisted check
    if (profile.isBlacklisted) {
      throw ApiError.forbidden(
        "Your account is restricted from placing orders due to multiple safety policy violations. Please contact ShopNest Customer Support."
      );
    }

    // 2. Cash on Delivery Restriction check
    if (profile.isCodRestricted && paymentMethod === "cash_on_delivery") {
      throw ApiError.forbidden(
        "Cash on Delivery is currently unavailable for your account due to previous unreceived/returned deliveries. Please use digital payment (bKash, SSLCommerz, or Card) to complete your order."
      );
    }
  }

  /**
   * List customer fraud profiles for admin dashboard with filtering and stats
   */
  static async listProfiles(query: {
    search?: string;
    riskLevel?: string;
    status?: string; // 'cod_restricted' | 'blacklisted' | 'clean'
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (query.search) {
      const s = query.search.trim();
      filter.$or = [
        { customerName: { $regex: s, $options: "i" } },
        { customerEmail: { $regex: s, $options: "i" } },
        { customerPhone: { $regex: s, $options: "i" } },
        { userId: s },
      ];
    }

    if (query.riskLevel && ["low", "medium", "high", "critical"].includes(query.riskLevel)) {
      filter.riskLevel = query.riskLevel;
    }

    if (query.status === "cod_restricted") {
      filter.isCodRestricted = true;
    } else if (query.status === "blacklisted") {
      filter.isBlacklisted = true;
    } else if (query.status === "clean") {
      filter.riskLevel = "low";
      filter.isCodRestricted = false;
      filter.isBlacklisted = false;
    }

    const [profiles, total, statsAgg] = await Promise.all([
      CustomerFraudProfile.find(filter)
        .sort({ riskScore: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CustomerFraudProfile.countDocuments(filter),
      CustomerFraudProfile.aggregate([
        {
          $group: {
            _id: null,
            totalMonitored: { $sum: 1 },
            criticalRisk: { $sum: { $cond: [{ $eq: ["$riskLevel", "critical"] }, 1, 0] } },
            highRisk: { $sum: { $cond: [{ $eq: ["$riskLevel", "high"] }, 1, 0] } },
            codRestricted: { $sum: { $cond: ["$isCodRestricted", 1, 0] } },
            blacklisted: { $sum: { $cond: ["$isBlacklisted", 1, 0] } },
            avgRiskScore: { $avg: "$riskScore" },
          },
        },
      ]),
    ]);

    const stats = statsAgg[0] || {
      totalMonitored: 0,
      criticalRisk: 0,
      highRisk: 0,
      codRestricted: 0,
      blacklisted: 0,
      avgRiskScore: 0,
    };

    return {
      profiles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalMonitored: stats.totalMonitored,
        criticalRisk: stats.criticalRisk,
        highRisk: stats.highRisk,
        codRestricted: stats.codRestricted,
        blacklisted: stats.blacklisted,
        avgRiskScore: Math.round(stats.avgRiskScore || 0),
      },
    };
  }

  /**
   * Get complete fraud dossier for a single customer
   */
  static async getCustomerDossier(userId: string) {
    let profile = await CustomerFraudProfile.findOne({ userId });
    if (!profile) {
      profile = await this.evaluateCustomer(userId);
    }
    if (!profile) throw ApiError.notFound("Customer profile not found");

    // Fetch recent orders
    const recentOrders = await Order.find({
      $or: [{ userId }, { customerId: userId } as any],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return {
      profile,
      recentOrders,
    };
  }

  /**
   * Admin actions: Update COD Restriction, Blacklist, or add Admin Note
   */
  static async updateStatus(
    userId: string,
    updates: {
      isCodRestricted?: boolean;
      isBlacklisted?: boolean;
      adminNotes?: string;
      reason?: string;
    },
    adminId?: string
  ) {
    const profile = await CustomerFraudProfile.findOne({ userId });
    if (!profile) throw ApiError.notFound("Customer fraud profile not found");

    const activityLogs = profile.activityLogs || [];
    const changes: string[] = [];

    if (updates.isCodRestricted !== undefined && updates.isCodRestricted !== profile.isCodRestricted) {
      profile.isCodRestricted = updates.isCodRestricted;
      changes.push(updates.isCodRestricted ? "Restricted COD access" : "Lifted COD restriction");
    }

    if (updates.isBlacklisted !== undefined && updates.isBlacklisted !== profile.isBlacklisted) {
      profile.isBlacklisted = updates.isBlacklisted;
      changes.push(updates.isBlacklisted ? "Blacklisted customer" : "Whitelisted customer");

      // Also sync banned status with better-auth user collection
      try {
        const objectId = safeObjectId(userId);
        await usersCollection().updateOne(
          { $or: [{ id: userId }, ...(objectId ? [{ _id: objectId }] : [])] },
          { $set: { banned: updates.isBlacklisted } }
        );
      } catch (err) {
        logger.error("Failed to sync banned flag with user collection", err);
      }
    }

    if (updates.adminNotes !== undefined) {
      profile.adminNotes = updates.adminNotes;
      changes.push("Updated admin notes");
    }

    if (changes.length > 0) {
      activityLogs.unshift({
        action: changes.join(", "),
        note: updates.reason || "Manual admin moderation action",
        adminId: adminId || "system_admin",
        at: new Date(),
      });
      profile.activityLogs = activityLogs.slice(0, 50); // keep last 50
    }

    await profile.save();
    return profile;
  }

  /**
   * Run a global scan on all customers who have placed orders or exist in user collection
   */
  static async runGlobalFraudScan() {
    // 1. Get all distinct userIds from orders
    const orderUserIds = await Order.distinct("userId");

    let scannedCount = 0;
    const batchSize = 25;

    for (let i = 0; i < orderUserIds.length; i += batchSize) {
      const chunk = orderUserIds.slice(i, i + batchSize);
      await Promise.all(
        chunk.map(async (uid) => {
          if (uid) {
            try {
              await CustomerFraudService.evaluateCustomer(uid);
              scannedCount++;
            } catch (err) {
              logger.warn(`Failed to scan customer ${uid}:`, err);
            }
          }
        })
      );
    }

    return {
      message: `Global customer fraud scan completed successfully. Evaluated ${scannedCount} customer profiles.`,
      scannedCount,
    };
  }
}
