import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { AuditLog } from "../../../security/auditLog.model";

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
