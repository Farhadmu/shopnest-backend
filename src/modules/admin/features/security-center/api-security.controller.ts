import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";

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
