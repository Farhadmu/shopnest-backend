import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { ApiError } from "../../../../utils/api-error";
import { SecurityLog } from "../../../security/securityLog.model";
import { SecurityIncident } from "../../../security/security-incident.model";
import { Store } from "../../../sellers/store.model";
import { AnomalyLog } from "../../admin-intelligence.model";
import { calculateSecurityHealth } from "./security-score.util";

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
