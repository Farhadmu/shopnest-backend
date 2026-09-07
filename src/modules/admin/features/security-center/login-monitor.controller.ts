import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";

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
