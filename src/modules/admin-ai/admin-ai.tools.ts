import mongoose from "mongoose";
import { Store } from "../sellers/store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { DeliveryManProfile } from "../delivery/delivery-man.model";
import { DeliveryRequest } from "../delivery/delivery-request.model";
import { Coupon } from "../coupons/coupon.model";
import { SecurityIncident } from "../security/security-incident.model";
import { AnomalyLog } from "../admin/admin-intelligence.model";
import { AuditLog } from "../security/auditLog.model";
import { createNotification } from "../notifications/notification.service";
import { AdminAIEvidence, AdminAIActionPreview, AdminAIAuditReceipt } from "./admin-ai.types";

function safeObjectId(id: string) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * READ TOOLS (Strictly querying real MongoDB collections)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export async function getMarketplaceBriefing(): Promise<{
  metrics: Array<{ label: string; value: string | number; formatted?: string; changePercent?: number; trend?: "up" | "down" | "neutral" }>;
  evidence: AdminAIEvidence[];
  summary: string;
}> {
  const db = mongoose.connection.db;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    totalSellers,
    pendingSellers,
    totalProducts,
    lowStockCount,
    todayOrdersAgg,
    yesterdayOrdersAgg,
    delayedDeliveries,
    activeIncidents,
    activeAnomalies,
  ] = await Promise.all([
    db ? db.collection("user").countDocuments() : 0,
    Store.countDocuments({ status: "approved" }),
    Store.countDocuments({ status: "pending" }),
    Product.countDocuments({ isDeleted: false }),
    Product.countDocuments({ isDeleted: false, stock: { $lte: 5 } }),
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfYesterday, $lt: startOfToday } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
    ]),
    DeliveryRequest.countDocuments({ status: { $in: ["assigned", "picked_up"] }, updatedAt: { $lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) } }),
    SecurityIncident.countDocuments({ status: { $in: ["open", "investigating"] } }),
    AnomalyLog.countDocuments({ status: "active" }),
  ]);

  const todayRevenue = todayOrdersAgg[0]?.revenue || 0;
  const todayOrders = todayOrdersAgg[0]?.count || 0;
  const yesterdayRevenue = yesterdayOrdersAgg[0]?.revenue || 0;
  const revDiff = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0;

  const metrics = [
    { label: "Today's Revenue", value: todayRevenue, formatted: `৳${todayRevenue.toLocaleString()}`, changePercent: Math.round(revDiff * 10) / 10, trend: revDiff >= 0 ? ("up" as const) : ("down" as const) },
    { label: "Today's Orders", value: todayOrders, formatted: `${todayOrders} orders` },
    { label: "Pending Sellers", value: pendingSellers, formatted: `${pendingSellers} waiting` },
    { label: "Low-Stock Alerts", value: lowStockCount, formatted: `${lowStockCount} items` },
    { label: "Delayed Deliveries", value: delayedDeliveries, formatted: `${delayedDeliveries} delayed` },
    { label: "Open Incidents", value: activeIncidents, formatted: `${activeIncidents} issues` },
  ];

  const evidence: AdminAIEvidence[] = [
    { source: "MongoDB.Order", fact: "Calculated today's revenue and order volume", value: `৳${todayRevenue.toLocaleString()} across ${todayOrders} orders`, recordCount: todayOrders, timestamp: now.toISOString() },
    { source: "MongoDB.Store", fact: "Checked merchant network status", value: `${totalSellers} approved, ${pendingSellers} pending approvals`, timestamp: now.toISOString() },
    { source: "MongoDB.Product", fact: "Audited inventory levels", value: `${lowStockCount} products with stock ≤ 5 out of ${totalProducts}`, timestamp: now.toISOString() },
    { source: "MongoDB.DeliveryRequest", fact: "Audited active delivery logistics", value: `${delayedDeliveries} deliveries delayed > 2 hours`, timestamp: now.toISOString() },
  ];

  const summary = `Marketplace Operating Status: ৳${todayRevenue.toLocaleString()} revenue from ${todayOrders} orders today. ` +
    `There are ${pendingSellers} merchant applications waiting for verification, ${lowStockCount} low-stock inventory alerts, and ${delayedDeliveries} deliveries flagged as delayed.`;

  return { metrics, evidence, summary };
}

export async function getSellers(params?: {
  status?: "pending" | "approved" | "rejected" | "suspended" | "all";
  search?: string;
  minRating?: number;
  maxRating?: number;
  limit?: number;
}): Promise<{
  sellers: Array<{ id: string; storeName: string; status: string; trustScore?: number; rating?: number; orders?: number; ownerEmail?: string; ownerName?: string; createdAt?: string }>;
  evidence: AdminAIEvidence[];
  count: number;
}> {
  const filter: Record<string, unknown> = {};
  if (params?.status && params.status !== "all") {
    filter.status = params.status;
  }
  if (params?.search && params.search.trim()) {
    const regex = new RegExp(params.search.trim(), "i");
    filter.$or = [
      { storeName: regex },
      { slug: regex },
      { "businessInfo.ownerName": regex },
      { "businessInfo.contactPhone": regex },
    ];
  }
  if (params?.maxRating !== undefined) {
    filter.rating = { $lte: params.maxRating };
  }
  if (params?.minRating !== undefined) {
    filter.rating = { ...(filter.rating as any || {}), $gte: params.minRating };
  }

  const limit = Math.min(params?.limit || 15, 50);
  const stores = await Store.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const db = mongoose.connection.db;

  let userMap = new Map<string, any>();
  if (db && stores.length > 0) {
    const ownerIds = stores.map((s) => s.ownerId).filter(Boolean);
    const validOids = ownerIds.map(safeObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
    const userDocs = await db.collection("user").find({
      $or: [{ id: { $in: ownerIds } }, { _id: { $in: validOids } }],
    }).toArray();
    userMap = new Map(userDocs.map((u) => [String(u.id ?? u._id), u]));
  }

  const sellers = stores.map((s: any) => {
    const u = userMap.get(s.ownerId);
    return {
      id: String(s._id || s.id),
      storeName: s.storeName,
      status: s.status,
      trustScore: s.trustScore ?? 50,
      rating: s.rating ?? 0,
      orders: s.orderCount ?? 0,
      ownerEmail: u?.email || null,
      ownerName: u?.name || s.businessInfo?.ownerName || null,
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
    };
  });

  const evidence: AdminAIEvidence[] = [
    {
      source: "MongoDB.Store",
      fact: `Retrieved sellers matching filter status="${params?.status || 'all'}"`,
      value: `Found ${sellers.length} records`,
      recordCount: sellers.length,
      timestamp: new Date().toISOString(),
    },
  ];

  return { sellers, evidence, count: sellers.length };
}

export async function findSellerByNameOrId(query: string): Promise<any | null> {
  const clean = query.trim();
  if (safeObjectId(clean)) {
    const byId = await Store.findById(clean).lean();
    if (byId) return byId;
  }
  const regex = new RegExp(`^${clean}$`, "i");
  let store = await Store.findOne({ $or: [{ storeName: regex }, { slug: regex }] }).lean();
  if (!store) {
    const partialRegex = new RegExp(clean, "i");
    store = await Store.findOne({ $or: [{ storeName: partialRegex }, { slug: partialRegex }] }).lean();
  }
  return store;
}

export async function getProducts(params?: {
  lowStock?: boolean;
  status?: "pending" | "approved" | "rejected";
  category?: string;
  storeId?: string;
  search?: string;
  limit?: number;
}): Promise<{
  products: Array<{ id: string; title: string; price: number; stock: number; status: string; category?: string; storeId?: string }>;
  evidence: AdminAIEvidence[];
  count: number;
}> {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (params?.lowStock) {
    filter.stock = { $lte: 5 };
  }
  if (params?.status) {
    filter.status = params.status;
  }
  if (params?.storeId) {
    filter.storeId = params.storeId;
  }
  if (params?.search && params.search.trim()) {
    filter.title = new RegExp(params.search.trim(), "i");
  }

  const limit = Math.min(params?.limit || 15, 50);
  const productsRaw = await Product.find(filter).sort({ stock: 1, createdAt: -1 }).limit(limit).lean();

  const products = productsRaw.map((p: any) => ({
    id: String(p._id || p.id),
    title: p.title,
    price: p.price,
    stock: p.stock,
    status: p.status || "approved",
    category: p.category || (typeof p.categoryId === "string" ? p.categoryId : undefined),
    storeId: p.storeId,
  }));

  const evidence: AdminAIEvidence[] = [
    {
      source: "MongoDB.Product",
      fact: params?.lowStock ? "Queried products with critical low stock (≤ 5)" : "Queried platform product catalog",
      value: `Found ${products.length} products`,
      recordCount: products.length,
      timestamp: new Date().toISOString(),
    },
  ];

  return { products, evidence, count: products.length };
}

export async function getOrders(params?: {
  todayOnly?: boolean;
  delayedOnly?: boolean;
  cancelledOnly?: boolean;
  minAmount?: number;
  limit?: number;
}): Promise<{
  orders: Array<{ id: string; status: string; totalAmount: number; customerName?: string; createdAt?: string; itemCount: number }>;
  evidence: AdminAIEvidence[];
  count: number;
}> {
  const filter: Record<string, unknown> = {};
  const now = new Date();

  if (params?.todayOnly) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    filter.createdAt = { $gte: startOfToday };
  }
  if (params?.cancelledOnly) {
    filter.status = "cancelled";
  }
  if (params?.minAmount) {
    filter.totalAmount = { $gte: params.minAmount };
  }
  if (params?.delayedOnly) {
    // Processing orders older than 48 hours
    const delayThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    filter.status = { $in: ["confirmed", "processing", "shipped"] };
    filter.createdAt = { $lt: delayThreshold };
  }

  const limit = Math.min(params?.limit || 15, 50);
  const ordersRaw = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

  const orders = ordersRaw.map((o: any) => ({
    id: String(o._id || o.id),
    status: o.status,
    totalAmount: o.totalAmount,
    customerName: o.shippingAddress?.fullName || "Customer",
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
    itemCount: Array.isArray(o.items) ? o.items.length : 1,
  }));

  const evidence: AdminAIEvidence[] = [
    {
      source: "MongoDB.Order",
      fact: params?.delayedOnly ? "Filtered orders delayed beyond 48 hours" : "Retrieved real marketplace orders",
      value: `Found ${orders.length} matching orders`,
      recordCount: orders.length,
      timestamp: new Date().toISOString(),
    },
  ];

  return { orders, evidence, count: orders.length };
}

export async function getDeliveryFleet(): Promise<{
  deliveries: Array<{ id: string; name: string; status: string; activeOrders: number; phone?: string; vehicleType?: string }>;
  evidence: AdminAIEvidence[];
  totalOnline: number;
}> {
  const [activeProfiles, activeRequests] = await Promise.all([
    DeliveryManProfile.find({ status: "approved" }).lean(),
    DeliveryRequest.aggregate([
      { $match: { status: { $in: ["assigned", "picked_up"] } } },
      { $group: { _id: "$deliveryManId", count: { $sum: 1 } } },
    ]),
  ]);

  const activeMap = new Map(activeRequests.map((r: any) => [String(r._id), r.count]));

  const deliveries = activeProfiles.map((p: any) => ({
    id: String(p._id || p.id),
    name: p.details?.personal?.fullName || `Rider ${String(p._id).slice(-4)}`,
    status: p.availabilityStatus || "offline",
    activeOrders: activeMap.get(String(p.userId)) || 0,
    phone: p.details?.personal?.phone || undefined,
    vehicleType: p.details?.vehicle?.vehicleType || "motorcycle",
  }));

  const onlineCount = deliveries.filter((d) => d.status === "online" || d.status === "busy").length;

  const evidence: AdminAIEvidence[] = [
    {
      source: "MongoDB.DeliveryManProfile",
      fact: "Queried active delivery fleet and real-time dispatches",
      value: `${onlineCount} riders online, ${deliveries.length} total registered partners`,
      recordCount: deliveries.length,
      timestamp: new Date().toISOString(),
    },
  ];

  return { deliveries, evidence, totalOnline: onlineCount };
}

export async function getAnomaliesAndIncidents(): Promise<{
  incidents: Array<{ id: string; title: string; severity: string; status: string; createdAt: string }>;
  anomalies: Array<{ id: string; anomalyType: string; severity: string; description: string }>;
  evidence: AdminAIEvidence[];
}> {
  const [incidentsRaw, anomaliesRaw] = await Promise.all([
    SecurityIncident.find({ status: { $in: ["open", "investigating"] } }).sort({ createdAt: -1 }).limit(10).lean(),
    AnomalyLog.find({ status: "active" }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const incidents = incidentsRaw.map((i: any) => ({
    id: String(i._id || i.id),
    title: i.title || "Security Alert",
    severity: i.severity || "medium",
    status: i.status || "open",
    createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
  }));

  const anomalies = anomaliesRaw.map((a: any) => ({
    id: String(a._id || a.id),
    anomalyType: a.anomalyType || a.type || "Revenue Leakage Alert",
    severity: a.severity || "medium",
    description: a.description || a.details?.reason || "Irregular pattern detected",
  }));

  const evidence: AdminAIEvidence[] = [
    {
      source: "MongoDB.SecurityIncident",
      fact: "Retrieved open security and anomaly alerts",
      value: `${incidents.length} active incidents, ${anomalies.length} active anomalies`,
      recordCount: incidents.length + anomalies.length,
      timestamp: new Date().toISOString(),
    },
  ];

  return { incidents, anomalies, evidence };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MUTATION TOOLS (Calling real domain controllers and generating audit logs)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export async function executeRejectSeller(params: {
  sellerId: string;
  reason?: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { sellerId, reason, adminId, adminName } = params;
  const store = await Store.findById(sellerId);
  if (!store) throw new Error(`Seller store not found with ID ${sellerId}`);

  const previousState = store.status;
  store.status = "rejected";
  store.rejectionReason = reason || "Incomplete verification documents";
  await store.save();

  // Create notification for seller
  await createNotification({
    userId: store.ownerId,
    recipientType: "seller",
    type: "admin_alert",
    category: "system",
    priority: "high",
    title: "Store Verification Rejected",
    message: `Your seller application for "${store.storeName}" was rejected. Reason: ${store.rejectionReason}`,
    source: "admin",
  }).catch(() => undefined);

  // Write security audit log
  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "SELLER_REJECTED",
    resource: "Store",
    resourceId: sellerId,
    status: "success",
    details: {
      storeName: store.storeName,
      previousState,
      newState: "rejected",
      reason: store.rejectionReason,
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "SELLER_REJECTED",
    targetType: "SELLER",
    targetId: sellerId,
    targetName: store.storeName,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: {
      previousState,
      newState: "rejected",
      reason: store.rejectionReason,
    },
  };
}

export async function executeApproveSeller(params: {
  sellerId: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { sellerId, adminId, adminName } = params;
  const store = await Store.findById(sellerId);
  if (!store) throw new Error(`Seller store not found with ID ${sellerId}`);

  const previousState = store.status;
  store.status = "approved";
  store.verifiedAt = new Date();
  store.verifiedBy = adminId;
  store.rejectionReason = "";
  store.suspensionReason = "";
  await store.save();

  // Sync role to user collection
  const db = mongoose.connection.db;
  if (db) {
    const uOid = safeObjectId(store.ownerId);
    await db.collection("user").updateOne(
      { $or: [{ id: store.ownerId }, ...(uOid ? [{ _id: uOid }] : [])] },
      { $set: { role: "seller" } }
    );
  }

  // Notify seller
  await createNotification({
    userId: store.ownerId,
    recipientType: "seller",
    type: "seller_approval",
    category: "system",
    priority: "high",
    title: "Store Verification Approved",
    message: `Congratulations! Your store "${store.storeName}" has been approved. You can now list products and receive orders.`,
    source: "admin",
  }).catch(() => undefined);

  // Write audit log
  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "SELLER_APPROVED",
    resource: "Store",
    resourceId: sellerId,
    status: "success",
    details: {
      storeName: store.storeName,
      previousState,
      newState: "approved",
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "SELLER_APPROVED",
    targetType: "SELLER",
    targetId: sellerId,
    targetName: store.storeName,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: { previousState, newState: "approved" },
  };
}

export async function executeCancelOrder(params: {
  orderId: string;
  reason?: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { orderId, reason, adminId, adminName } = params;
  const order = await Order.findById(orderId);
  if (!order) throw new Error(`Order not found with ID ${orderId}`);

  const previousState = order.status;
  if (order.status === "delivered") {
    throw new Error("Cannot cancel an order that has already been delivered.");
  }

  order.status = "cancelled";
  order.cancellationReason = reason || "Cancelled by Administrator via Admin AI";
  await order.save();

  // Restore inventory
  if (Array.isArray(order.items)) {
    for (const item of order.items) {
      if (item.productId) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity } });
      }
    }
  }

  // Notify customer
  await createNotification({
    userId: order.userId,
    recipientType: "user",
    type: "order_cancelled",
    category: "orders",
    priority: "high",
    title: `Order #${String(order._id).slice(-6)} Cancelled`,
    message: `Your order #${String(order._id).slice(-6)} was cancelled. Reason: ${order.cancellationReason}`,
    source: "admin",
  }).catch(() => undefined);

  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "ORDER_CANCELLED",
    resource: "Order",
    resourceId: orderId,
    status: "success",
    details: {
      orderId,
      previousState,
      newState: "cancelled",
      reason: order.cancellationReason,
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "ORDER_CANCELLED",
    targetType: "ORDER",
    targetId: orderId,
    targetName: `Order #${orderId.slice(-6)}`,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: { previousState, newState: "cancelled", reason: order.cancellationReason },
  };
}

export async function executeDisableCoupon(params: {
  couponCode: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { couponCode, adminId, adminName } = params;
  const coupon = await Coupon.findOne({ code: couponCode.toUpperCase().trim() });
  if (!coupon) throw new Error(`Coupon with code "${couponCode}" not found.`);

  const previousState = coupon.isActive ? "active" : "inactive";
  coupon.isActive = false;
  await coupon.save();

  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "COUPON_DISABLED",
    resource: "Coupon",
    resourceId: String(coupon._id),
    status: "success",
    details: {
      code: coupon.code,
      previousState,
      newState: "inactive",
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "COUPON_DISABLED",
    targetType: "COUPON",
    targetId: String(coupon._id),
    targetName: coupon.code,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: { code: coupon.code, previousState, newState: "inactive" },
  };
}

export async function executeResolveIncident(params: {
  incidentId: string;
  notes?: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { incidentId, notes, adminId, adminName } = params;
  const incident = await SecurityIncident.findById(incidentId);
  if (!incident) throw new Error(`Security Incident not found with ID ${incidentId}`);

  const previousState = incident.status;
  incident.status = "resolved";
  incident.resolvedAt = new Date();
  incident.resolvedBy = adminId;
  if (notes) incident.resolutionSummary = notes;
  await incident.save();

  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "INCIDENT_RESOLVED",
    resource: "SecurityIncident",
    resourceId: incidentId,
    status: "success",
    details: {
      title: incident.title,
      previousState,
      newState: "resolved",
      notes: notes || "Resolved via Admin AI",
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "INCIDENT_RESOLVED",
    targetType: "INCIDENT",
    targetId: incidentId,
    targetName: incident.title,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: { title: incident.title, previousState, newState: "resolved" },
  };
}

export async function executeBroadcastNotification(params: {
  recipientType: "seller" | "user" | "all";
  title: string;
  message: string;
  adminId: string;
  adminName: string;
}): Promise<AdminAIAuditReceipt> {
  const { recipientType, title, message, adminId, adminName } = params;

  let targetCount = 0;
  if (recipientType === "seller" || recipientType === "all") {
    const stores = await Store.find({ status: "approved" }).select("ownerId").lean();
    targetCount += stores.length;
    for (const store of stores) {
      await createNotification({
        userId: store.ownerId,
        recipientType: "seller",
        type: "admin_alert",
        category: "system",
        priority: "high",
        title,
        message,
        source: "admin",
      }).catch(() => undefined);
    }
  }

  const audit = await AuditLog.create({
    actorId: adminId,
    actorName: adminName,
    role: "admin",
    action: "NOTIFICATION_BROADCAST",
    resource: "Notification",
    status: "success",
    details: {
      recipientType,
      title,
      message,
      targetCount,
      executedBy: "ADMIN_AI",
    },
  });

  return {
    auditId: String(audit._id),
    action: "NOTIFICATION_BROADCAST",
    targetType: "NOTIFICATION",
    targetName: `Broadcast to ${targetCount} recipients`,
    performedBy: adminName,
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    details: { recipientType, title, targetCount },
  };
}
