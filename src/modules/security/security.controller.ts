import { Request, Response } from "express";
import { SecurityLog } from "./securityLog.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const listSecurityLogs = asyncHandler(async (req: Request, res: Response) => {
  const { resolved, severity } = req.query as { resolved?: string; severity?: string };
  const filter: Record<string, unknown> = {};
  if (resolved !== undefined) filter.resolved = resolved === "true";
  if (severity) filter.severity = severity;

  const logs = await SecurityLog.find(filter).sort({ createdAt: -1 }).limit(300);
  res.status(200).json(logs);
});

export const resolveSecurityLog = asyncHandler(async (req: Request, res: Response) => {
  const log = await SecurityLog.findByIdAndUpdate(req.params.id, { resolved: true }, { new: true });
  if (!log) throw ApiError.notFound("Log not found");
  sendSuccess(res, log.toJSON(), "Marked as resolved");
});
