import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { SecurityLog } from "../../../security/securityLog.model";
import { createIncidentFromSecurityLog } from "../security-incidents.service";

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

// Auto-seed incident from high/critical security logs that lack one
export async function ensureIncidentForEvent(logEntry: any) {
  if (logEntry.resolved || logEntry.severity !== "high" && logEntry.severity !== "critical") return null;

  const typeMap: Record<string, string> = {
    LOGIN_ANOMALY: "suspicious_login",
    SUSPICIOUS_ORDER: "suspicious_order_activity",
    RATE_LIMIT_BREACH: "rate_limit_abuse",
    ADMIN_ACTION: "system_security_incident",
    AI_MISUSE: "api_abuse",
  };

  return createIncidentFromSecurityLog(
    logEntry,
    logEntry.severity,
    (typeMap[logEntry.type] || "other") as any,
    "security_log"
  );
}

