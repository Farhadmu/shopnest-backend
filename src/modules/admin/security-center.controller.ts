import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { SecurityIncident } from "../security/security-incident.model";
import { AuditLog } from "../security/auditLog.model";
import { SecurityLog } from "../security/securityLog.model";
import { SecurityRiskLog } from "../security/security-intelligence.model";
import { Store } from "../sellers/store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { AnomalyLog } from "./admin-intelligence.model";

// 1. SECURITY OVERVIEW
export const getSecurityOverview = asyncHandler(async (_req: Request, res: Response) => {
  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    suspendedUsers,
    blockedUsers,
    totalSellers,
    suspendedSellers,
    pendingSellers,
    activeAlerts,
    criticalAlerts,
    failedLogins24h,
    suspiciousActivities,
    openIncidents,
    criticalIncidents,
    blockedRequests,
    rateLimitViolations,
    recentEvents,
  ] = await Promise.all([
    db.collection("user").countDocuments(),
    db.collection("user").countDocuments({ status: "suspended" }),
    db.collection("user").countDocuments({ status: "blocked" }),
    Store.countDocuments({ status: "approved" }),
    Store.countDocuments({ status: "suspended" }),
    Store.countDocuments({ status: "pending" }),
    SecurityLog.countDocuments({ resolved: false }),
    SecurityLog.countDocuments({ resolved: false, severity: { $in: ["high", "critical"] } }),
    SecurityLog.countDocuments({ type: "LOGIN_ANOMALY", createdAt: { $gte: oneDayAgo } }),
    AnomalyLog.countDocuments({ status: { $in: ["detected", "under_review"] } }),
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] } }),
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] }, severity: "critical" }),
    SecurityLog.countDocuments({ type: "RATE_LIMIT_BREACH", createdAt: { $gte: sevenDaysAgo } }),
    SecurityLog.countDocuments({ type: "RATE_LIMIT_BREACH", createdAt: { $gte: thirtyDaysAgo } }),
    SecurityLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
  ]);

  const totalActiveUsers = totalUsers - suspendedUsers - blockedUsers;
  const highRiskSellers = await Store.countDocuments({ trustScore: { $lt: 40 }, status: "approved" });

  sendSuccess(res, {
    securityHealth: calculateSecurityHealth({
      suspendedUsers, blockedUsers, totalUsers, openIncidents, criticalIncidents,
      failedLogins24h, rateLimitViolations, suspiciousActivities,
    }),
    activeAlerts,
    criticalAlerts,
    suspiciousActivities,
    failedLoginAttempts: failedLogins24h,
    suspendedAccounts: suspendedUsers + suspendedSellers,
    blockedRequests,
    rateLimitViolations,
    recentSecurityEvents: recentEvents,
    totalUsers,
    totalActiveUsers,
    suspendedUsers,
    blockedUsers,
    totalSellers,
    suspendedSellers,
    pendingSellers,
    highRiskSellers,
    openIncidents,
    criticalIncidents,
  });
});

// 2. SECURITY HEALTH SCORE
export const getSecurityHealth = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    suspendedUsers,
    blockedUsers,
    failedLogins,
    openIncidents,
    criticalIncidents,
    rateLimitViolations,
    suspiciousOrders,
    totalSellers,
    suspendedSellers,
    highRiskSellers,
    resolvedIncidents,
    totalIncidents,
  ] = await Promise.all([
    mongoose.connection.db?.collection("user").countDocuments() || 0,
    mongoose.connection.db?.collection("user").countDocuments({ status: "suspended" }) || 0,
    mongoose.connection.db?.collection("user").countDocuments({ status: "blocked" }) || 0,
    SecurityLog.countDocuments({ type: "LOGIN_ANOMALY", createdAt: { $gte: thirtyDaysAgo } }),
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] } }),
    SecurityIncident.countDocuments({ severity: "critical", status: { $in: ["new", "investigating"] } }),
    SecurityLog.countDocuments({ type: "RATE_LIMIT_BREACH", createdAt: { $gte: thirtyDaysAgo } }),
    SecurityLog.countDocuments({ type: "SUSPICIOUS_ORDER", createdAt: { $gte: thirtyDaysAgo } }),
    Store.countDocuments({ status: "approved" }),
    Store.countDocuments({ status: "suspended" }),
    Store.countDocuments({ trustScore: { $lt: 40 }, status: "approved" }),
    SecurityIncident.countDocuments({ status: "resolved", createdAt: { $gte: thirtyDaysAgo } }),
    SecurityIncident.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
  ]);

  const authSecurity = calculateAuthSecurity(failedLogins, totalUsers);
  const accountSecurity = calculateAccountSecurity(suspendedUsers, blockedUsers, totalUsers);
  const sellerSecurity = calculateSellerSecurity(suspendedSellers, highRiskSellers, totalSellers);
  const apiSecurity = calculateApiSecurity(rateLimitViolations);
  const incidentManagement = calculateIncidentManagement(resolvedIncidents, totalIncidents);

  const overallScore = Math.round(
    authSecurity * 0.25 + accountSecurity * 0.25 + sellerSecurity * 0.2 + apiSecurity * 0.15 + incidentManagement * 0.15
  );

  sendSuccess(res, {
    overallScore,
    status: overallScore >= 90 ? "Excellent" : overallScore >= 75 ? "Good" : overallScore >= 50 ? "Warning" : "Critical",
    breakdown: {
      authenticationSecurity: { score: authSecurity, weight: 25, factors: [`${failedLogins} failed login attempts (30d)`] },
      accountSecurity: { score: accountSecurity, weight: 25, factors: [`${suspendedUsers} suspended users`, `${blockedUsers} blocked users`] },
      sellerSecurity: { score: sellerSecurity, weight: 20, factors: [`${suspendedSellers} suspended sellers`, `${highRiskSellers} high-risk sellers`] },
      apiSecurity: { score: apiSecurity, weight: 15, factors: [`${rateLimitViolations} rate limit violations (30d)`] },
      incidentManagement: { score: incidentManagement, weight: 15, factors: [`${openIncidents} open incidents`, `${resolvedIncidents} resolved (30d)`] },
    },
    factors: [
      ...(failedLogins > 10 ? [`High number of failed login attempts: ${failedLogins}`] : []),
      ...(criticalIncidents > 0 ? [`${criticalIncidents} critical incidents require attention`] : []),
      ...(suspendedUsers > 0 ? [`${suspendedUsers} user accounts currently suspended`] : []),
      ...(highRiskSellers > 0 ? [`${highRiskSellers} sellers flagged as high-risk`] : []),
      ...(rateLimitViolations > 20 ? [`Elevated rate limit violations: ${rateLimitViolations}`] : []),
    ],
  });
});

// 3. LOGIN SECURITY MONITOR
export const getLoginSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { range = "7d" } = req.query as { range?: string };

  const now = new Date();
  const rangeMs = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[range] || 7 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);
  const prevStartDate = new Date(startDate.getTime() - rangeMs);

  const loginLogs = await SecurityLog.find({
    type: "LOGIN_ANOMALY",
    createdAt: { $gte: startDate },
  }).sort({ createdAt: -1 }).limit(100);

  const prevLoginLogs = await SecurityLog.countDocuments({
    type: "LOGIN_ANOMALY",
    createdAt: { $gte: prevStartDate, $lt: startDate },
  });

  const failedLogins = loginLogs.length;
  const prevFailedLogins = prevLoginLogs;
  const changePercent = prevFailedLogins > 0
    ? Math.round(((failedLogins - prevFailedLogins) / prevFailedLogins) * 1000) / 10
    : failedLogins > 0 ? 100 : 0;

  const timelineMap: Record<string, { failed: number; success: number }> = {};
  loginLogs.forEach((log) => {
    const d = new Date(log.createdAt);
    const label = range === "1d"
      ? d.toLocaleTimeString("default", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("default", { month: "short", day: "numeric" });
    if (!timelineMap[label]) timelineMap[label] = { failed: 0, success: 0 };
    timelineMap[label].failed += 1;
  });

  const timeline = Object.entries(timelineMap).map(([label, data]) => ({
    label,
    failed: data.failed,
    success: data.success,
  })).reverse();

  const roleBreakdown = await SecurityLog.aggregate([
    { $match: { type: "LOGIN_ANOMALY", createdAt: { $gte: startDate } } },
    { $group: { _id: "$details.role", count: { $sum: 1 } } },
  ]);

  sendSuccess(res, {
    range,
    failedLogins,
    prevFailedLogins,
    changePercent,
    timeline,
    roleBreakdown: roleBreakdown.map((r) => ({ role: r._id || "unknown", count: r.count })),
    recentAttempts: loginLogs.slice(0, 20).map((log) => ({
      id: log._id,
      userId: log.userId,
      ip: log.ip,
      message: log.message,
      severity: log.severity,
      timestamp: log.createdAt,
      resolved: log.resolved,
    })),
  });
});

// 4. SUSPICIOUS ACTIVITY DETECTION
export const getSuspiciousActivity = asyncHandler(async (req: Request, res: Response) => {
  const { range = "7d", severity, status, page = 1, limit = 20 } = req.query as {
    range?: string; severity?: string; status?: string; page?: string; limit?: string;
  };

  const now = new Date();
  const rangeMs = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[range] || 7 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = { createdAt: { $gte: startDate } };
  if (severity) filter.severity = severity;
  if (status) filter.resolved = status === "resolved";

  const [activities, total] = await Promise.all([
    SecurityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    SecurityLog.countDocuments(filter),
  ]);

  const severityBreakdown = await SecurityLog.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);

  const typeBreakdown = await SecurityLog.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);

  sendSuccess(res, {
    activities: activities.map((a) => ({
      id: a._id,
      type: a.type,
      userId: a.userId,
      ip: a.ip,
      message: a.message,
      severity: a.severity,
      timestamp: a.createdAt,
      resolved: a.resolved,
      details: a.details,
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    severityBreakdown: severityBreakdown.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    typeBreakdown: typeBreakdown.map((t) => ({ type: t._id, count: t.count })),
  });
});

// 5. ACCOUNT SECURITY
export const getAccountSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { status, search, page = 1, limit = 20 } = req.query as {
    status?: string; search?: string; page?: string; limit?: string;
  };

  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const [users, total, suspendedCount, blockedCount, recentRegistrations] = await Promise.all([
    db.collection("user").find(filter).skip(skip).limit(Number(limit)).sort({ createdAt: -1 }).toArray(),
    db.collection("user").countDocuments(filter),
    db.collection("user").countDocuments({ status: "suspended" }),
    db.collection("user").countDocuments({ status: "blocked" }),
    db.collection("user").countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);

  const suspiciousUserIds = await SecurityLog.distinct("userId", {
    severity: { $in: ["high", "critical"] },
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  });

  sendSuccess(res, {
    users: users.map((u: any) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role || "customer",
      status: u.status || "active",
      createdAt: u.createdAt,
      hasSecurityActivity: suspiciousUserIds.some((id) => id?.toString() === u._id?.toString()),
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: {
      total,
      suspended: suspendedCount,
      blocked: blockedCount,
      active: total - suspendedCount - blockedCount,
      recentRegistrations,
      flaggedForReview: suspiciousUserIds.length,
    },
  });
});

// Update user status (suspend/activate/block)
export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!["active", "suspended", "blocked"].includes(status)) {
    throw ApiError.badRequest("Invalid status value");
  }

  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const result = await db.collection("user").updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { status, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw ApiError.notFound("User not found");

  await AuditLog.create({
    actorId: req.user?.id || "system",
    actorName: req.user?.name || "Admin",
    role: "admin",
    action: status === "suspended" ? "SUSPENDED_USER" : status === "blocked" ? "BLOCKED_USER" : "ACTIVATED_USER",
    resource: "User",
    resourceId: id,
    status: "success",
    details: { reason },
  });

  sendSuccess(res, { id, status }, `User ${status} successfully`);
});

// 6. SELLER SECURITY
export const getSellerSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { status, riskLevel, page = 1, limit = 20 } = req.query as {
    status?: string; riskLevel?: string; page?: string; limit?: string;
  };

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;

  let storeQuery = Store.find(filter);
  if (riskLevel === "high") storeQuery = Store.find({ ...filter, trustScore: { $lt: 40 } });
  if (riskLevel === "medium") storeQuery = Store.find({ ...filter, trustScore: { $gte: 40, $lt: 70 } });
  if (riskLevel === "low") storeQuery = Store.find({ ...filter, trustScore: { $gte: 70 } });

  const [sellers, total, verifiedCount, pendingCount, suspendedCount] = await Promise.all([
    storeQuery.sort({ trustScore: -1 }).skip(skip).limit(Number(limit)),
    Store.countDocuments(filter),
    Store.countDocuments({ status: "approved" }),
    Store.countDocuments({ status: "pending" }),
    Store.countDocuments({ status: "suspended" }),
  ]);

  const highRiskCount = await Store.countDocuments({ trustScore: { $lt: 40 }, status: "approved" });
  const mediumRiskCount = await Store.countDocuments({ trustScore: { $gte: 40, $lt: 70 }, status: "approved" });
  const lowRiskCount = await Store.countDocuments({ trustScore: { $gte: 70 }, status: "approved" });

  sendSuccess(res, {
    sellers: sellers.map((s) => ({
      id: s._id,
      storeName: s.storeName,
      ownerId: s.ownerId,
      status: s.status,
      trustScore: s.trustScore,
      rating: s.rating,
      riskLevel: s.trustScore < 40 ? "high" : s.trustScore < 70 ? "medium" : "low",
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: {
      total,
      verified: verifiedCount,
      pending: pendingCount,
      suspended: suspendedCount,
      highRisk: highRiskCount,
      mediumRisk: mediumRiskCount,
      lowRisk: lowRiskCount,
    },
  });
});

// 7. API & REQUEST SECURITY
export const getApiSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { range = "7d" } = req.query as { range?: string };

  const now = new Date();
  const rangeMs = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  }[range] || 7 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);

  const rateLimitBreaches = await SecurityLog.countDocuments({
    type: "RATE_LIMIT_BREACH",
    createdAt: { $gte: startDate },
  });

  const unauthorizedAttempts = await SecurityLog.countDocuments({
    type: { $in: ["LOGIN_ANOMALY"] },
    severity: { $in: ["high", "critical"] },
    createdAt: { $gte: startDate },
  });

  const timelineMap: Record<string, { blocked: number; unauthorized: number }> = {};
  const breachLogs = await SecurityLog.find({
    type: "RATE_LIMIT_BREACH",
    createdAt: { $gte: startDate },
  });

  breachLogs.forEach((log) => {
    const d = new Date(log.createdAt);
    const label = range === "1d"
      ? d.toLocaleTimeString("default", { hour: "2-digit" })
      : d.toLocaleDateString("default", { month: "short", day: "numeric" });
    if (!timelineMap[label]) timelineMap[label] = { blocked: 0, unauthorized: 0 };
    timelineMap[label].blocked += 1;
  });

  const timeline = Object.entries(timelineMap).map(([label, data]) => ({
    label,
    ...data,
  })).reverse();

  sendSuccess(res, {
    range,
    rateLimitBreaches,
    unauthorizedAttempts,
    blockedRequests: rateLimitBreaches,
    timeline,
  });
});

// 8. SECURITY INCIDENTS
export const getSecurityIncidents = asyncHandler(async (req: Request, res: Response) => {
  const { status, severity, page = 1, limit = 20 } = req.query as {
    status?: string; severity?: string; page?: string; limit?: string;
  };

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;

  const [incidents, total, openCount, investigatingCount, resolvedCount, criticalCount] = await Promise.all([
    SecurityIncident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    SecurityIncident.countDocuments(filter),
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] } }),
    SecurityIncident.countDocuments({ status: "investigating" }),
    SecurityIncident.countDocuments({ status: "resolved" }),
    SecurityIncident.countDocuments({ severity: "critical", status: { $in: ["new", "investigating"] } }),
  ]);

  sendSuccess(res, {
    incidents: incidents.map((i) => ({
      id: i._id,
      incidentCode: i.incidentCode,
      title: i.title,
      entityType: i.entityType,
      entityName: i.entityName,
      severity: i.severity,
      status: i.status,
      riskScore: i.riskScore,
      signals: i.signals,
      notes: i.notes,
      history: i.history,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: { total, open: openCount, investigating: investigatingCount, resolved: resolvedCount, critical: criticalCount },
  });
});

// Update incident status
export const updateIncidentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ["new", "investigating", "resolved", "dismissed"];
  if (!validStatuses.includes(status)) throw ApiError.badRequest("Invalid status");

  const incident = await SecurityIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");

  const update: any = { status };
  if (status === "resolved") update.resolvedAt = new Date();
  if (notes) {
    update.$push = { notes: { authorId: req.user?.id, authorName: req.user?.name, note: notes, createdAt: new Date() } };
  }

  const updated = await SecurityIncident.findByIdAndUpdate(id, update, { new: true });

  await AuditLog.create({
    actorId: req.user?.id || "system",
    actorName: req.user?.name || "Admin",
    role: "admin",
    action: `INCIDENT_${status.toUpperCase()}`,
    resource: "SecurityIncident",
    resourceId: id,
    status: "success",
    details: { previousStatus: incident.status, notes },
  });

  sendSuccess(res, updated, `Incident ${status}`);
});

// 9. SECURITY ALERTS
export const getSecurityAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { range = "7d", severity } = req.query as { range?: string; severity?: string };

  const now = new Date();
  const rangeMs = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  }[range] || 7 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);

  const filter: any = { createdAt: { $gte: startDate } };
  if (severity) filter.severity = severity;

  const alerts = await SecurityLog.find(filter).sort({ createdAt: -1 }).limit(50);

  const alertList = alerts.map((a) => ({
    id: a._id,
    type: a.type,
    message: a.message,
    severity: a.severity,
    timestamp: a.createdAt,
    resolved: a.resolved,
  }));

  sendSuccess(res, {
    alerts: alertList,
    total: alertList.length,
    bySeverity: {
      critical: alertList.filter((a) => a.severity === "critical").length,
      high: alertList.filter((a) => a.severity === "high").length,
      medium: alertList.filter((a) => a.severity === "medium").length,
      low: alertList.filter((a) => a.severity === "low").length,
    },
  });
});

// Mark alert as resolved
export const resolveAlert = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const alert = await SecurityLog.findByIdAndUpdate(id, { resolved: true }, { new: true });
  if (!alert) throw ApiError.notFound("Alert not found");
  sendSuccess(res, { id, resolved: true }, "Alert resolved");
});

// 10. AUDIT LOG
export const getSecurityAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { range = "7d", action, status, page = 1, limit = 20 } = req.query as {
    range?: string; action?: string; status?: string; page?: string; limit?: string;
  };

  const now = new Date();
  const rangeMs = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[range] || 7 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = { createdAt: { $gte: startDate } };
  if (action) filter.action = { $regex: action, $options: "i" };
  if (status) filter.status = status;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);

  sendSuccess(res, {
    logs: logs.map((l) => ({
      id: l._id,
      actorName: l.actorName,
      actorRole: l.role,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      status: l.status,
      ip: l.ip,
      details: l.details,
      timestamp: l.createdAt,
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  });
});

// 11. SECURITY ANALYTICS
export const getSecurityAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { range = "30d" } = req.query as { range?: string };

  const now = new Date();
  const rangeMs = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "180d": 180 * 24 * 60 * 60 * 1000,
    "365d": 365 * 24 * 60 * 60 * 1000,
  }[range] || 30 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);

  const failedLoginTimeline = await SecurityLog.aggregate([
    { $match: { type: "LOGIN_ANOMALY", createdAt: { $gte: startDate } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const incidentTimeline = await SecurityIncident.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const suspiciousActivityTimeline = await SecurityLog.aggregate([
    { $match: { type: "SUSPICIOUS_ORDER", createdAt: { $gte: startDate } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const riskDistribution = await SecurityLog.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);

  const totalRiskEvents = riskDistribution.reduce((sum, r) => sum + r.count, 0);
  const riskPercentages = riskDistribution.map((r) => ({
    severity: r._id,
    count: r.count,
    percentage: totalRiskEvents > 0 ? Math.round((r.count / totalRiskEvents) * 1000) / 10 : 0,
  }));

  sendSuccess(res, {
    range,
    failedLoginTrend: failedLoginTimeline.map((d) => ({ date: d._id, count: d.count })),
    incidentTrend: incidentTimeline.map((d) => ({ date: d._id, count: d.count })),
    suspiciousActivityTrend: suspiciousActivityTimeline.map((d) => ({ date: d._id, count: d.count })),
    riskDistribution: riskPercentages,
  });
});

// 12. SECURITY RECOMMENDATIONS
export const getSecurityRecommendations = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    failedLoginsCurrent,
    failedLoginsPrevious,
    criticalIncidents,
    highRiskSellers,
    pendingSellers,
    rateLimitCurrent,
    rateLimitPrevious,
    suspendedUsers,
    openIncidents,
  ] = await Promise.all([
    SecurityLog.countDocuments({ type: "LOGIN_ANOMALY", createdAt: { $gte: thirtyDaysAgo } }),
    SecurityLog.countDocuments({ type: "LOGIN_ANOMALY", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
    SecurityIncident.countDocuments({ severity: "critical", status: { $in: ["new", "investigating"] } }),
    Store.countDocuments({ trustScore: { $lt: 40 }, status: "approved" }),
    Store.countDocuments({ status: "pending" }),
    SecurityLog.countDocuments({ type: "RATE_LIMIT_BREACH", createdAt: { $gte: sevenDaysAgo } }),
    SecurityLog.countDocuments({ type: "RATE_LIMIT_BREACH", createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } }),
    mongoose.connection.db?.collection("user").countDocuments({ status: "suspended" }) || 0,
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] } }),
  ]);

  const recommendations: Array<{ type: string; message: string; severity: string }> = [];

  if (failedLoginsPrevious > 0) {
    const change = ((failedLoginsCurrent - failedLoginsPrevious) / failedLoginsPrevious) * 100;
    if (change > 20) {
      recommendations.push({
        type: "authentication",
        message: `Failed login attempts increased by ${Math.round(change)}% compared to the previous period.`,
        severity: "warning",
      });
    }
  }

  if (criticalIncidents > 0) {
    recommendations.push({
      type: "incidents",
      message: `${criticalIncidents} critical security incident${criticalIncidents > 1 ? "s" : ""} require${criticalIncidents === 1 ? "s" : ""} immediate attention.`,
      severity: "critical",
    });
  }

  if (highRiskSellers > 0) {
    recommendations.push({
      type: "sellers",
      message: `${highRiskSellers} seller account${highRiskSellers > 1 ? "s" : ""} ${highRiskSellers > 1 ? "are" : "is"} flagged as high-risk and may require review.`,
      severity: "warning",
    });
  }

  if (pendingSellers > 5) {
    recommendations.push({
      type: "sellers",
      message: `${pendingSellers} seller applications are pending verification.`,
      severity: "info",
    });
  }

  if (rateLimitPrevious > 0) {
    const change = ((rateLimitCurrent - rateLimitPrevious) / rateLimitPrevious) * 100;
    if (change > 30) {
      recommendations.push({
        type: "api",
        message: `API rate-limit violations increased by ${Math.round(change)}% this week.`,
        severity: "warning",
      });
    }
  }

  if (openIncidents > 10) {
    recommendations.push({
      type: "incidents",
      message: `${openIncidents} open security incidents may need prioritization.`,
      severity: "warning",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      type: "general",
      message: "Security posture is stable. Continue monitoring for anomalies.",
      severity: "success",
    });
  }

  sendSuccess(res, { recommendations });
});

// Helper functions for health score calculation
function calculateSecurityHealth(data: {
  suspendedUsers: number;
  blockedUsers: number;
  totalUsers: number;
  openIncidents: number;
  criticalIncidents: number;
  failedLogins24h: number;
  rateLimitViolations: number;
  suspiciousActivities: number;
}): number {
  let score = 100;

  const userPenalty = data.totalUsers > 0
    ? ((data.suspendedUsers + data.blockedUsers) / data.totalUsers) * 20
    : 0;
  score -= Math.min(userPenalty, 20);

  score -= Math.min(data.openIncidents * 2, 15);
  score -= Math.min(data.criticalIncidents * 5, 15);
  score -= Math.min(data.failedLogins24h * 0.5, 10);
  score -= Math.min(data.rateLimitViolations * 1, 10);
  score -= Math.min(data.suspiciousActivities * 2, 10);

  return Math.max(0, Math.round(score));
}

function calculateAuthSecurity(failedLogins: number, totalUsers: number): number {
  let score = 100;
  if (totalUsers > 0) {
    const failRate = failedLogins / totalUsers;
    score -= Math.min(failRate * 100, 30);
  }
  return Math.max(0, Math.round(score));
}

function calculateAccountSecurity(suspended: number, blocked: number, total: number): number {
  let score = 100;
  if (total > 0) {
    const issueRate = (suspended + blocked) / total;
    score -= Math.min(issueRate * 200, 40);
  }
  return Math.max(0, Math.round(score));
}

function calculateSellerSecurity(suspended: number, highRisk: number, total: number): number {
  let score = 100;
  if (total > 0) {
    const issueRate = (suspended + highRisk) / total;
    score -= Math.min(issueRate * 150, 40);
  }
  return Math.max(0, Math.round(score));
}

function calculateApiSecurity(rateLimitViolations: number): number {
  let score = 100;
  score -= Math.min(rateLimitViolations * 2, 30);
  return Math.max(0, Math.round(score));
}

function calculateIncidentManagement(resolved: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((resolved / total) * 100);
}
