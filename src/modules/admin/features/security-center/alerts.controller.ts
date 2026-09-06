import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { ApiError } from "../../../../utils/api-error";
import { SecurityLog } from "../../../security/securityLog.model";

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
