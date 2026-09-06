import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";
import { SecurityIncident } from "../../../security/security-incident.model";
import { Store } from "../../../sellers/store.model";

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
