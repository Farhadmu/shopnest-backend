import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { AuditLog } from "../../security/auditLog.model";

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { role, action, resource, search } = req.query as { role?: string; action?: string; resource?: string; search?: string };

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (action) filter.action = action;
  if (resource) filter.resource = resource;
  if (search) {
    filter.$or = [
      { actorName: { $regex: search, $options: "i" } },
      { action: { $regex: search, $options: "i" } },
      { resource: { $regex: search, $options: "i" } },
    ];
  }

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(100);

  sendSuccess(res, logs);
});
