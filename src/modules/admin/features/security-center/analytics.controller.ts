import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";
import { SecurityIncident } from "../../../security/security-incident.model";

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
