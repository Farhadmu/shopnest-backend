import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";
import { SecurityIncident } from "../../../security/security-incident.model";
import { Store } from "../../../sellers/store.model";
import {
  calculateAuthSecurity,
  calculateAccountSecurity,
  calculateSellerSecurity,
  calculateApiSecurity,
  calculateIncidentManagement,
} from "./security-score.util";

// 2. SECURITY HEALTH SCORE
export const getSecurityHealth = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

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
