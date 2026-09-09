import { Request, Response } from "express";
import { SecurityLog } from "./securityLog.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Controller: List Security Logs (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.query.resolved: Optional filter ("true" / "false")
 *    - req.query.severity: Optional filter ("low" | "medium" | "high" | "critical")
 * 2. Database Operation:
 *    - SecurityLog.find(filter).sort({ createdAt: -1 }).limit(300)
 * 3. Response Sent:
 *    - HTTP 200: Raw array of SecurityLog documents (SecurityLog[])
 */
export const listSecurityLogs = asyncHandler(async (req: Request, res: Response) => {
  const { resolved, severity } = req.query as { resolved?: string; severity?: string };
  const filter: Record<string, unknown> = {};
  if (resolved !== undefined) filter.resolved = resolved === "true";
  if (severity) filter.severity = severity;

  const logs = await SecurityLog.find(filter).sort({ createdAt: -1 }).limit(300);
  res.status(200).json(logs);
});

/**
 * Controller: Mark Security Log As Resolved (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: SecurityLog document ID
 * 2. Database Operation:
 *    - SecurityLog.findByIdAndUpdate(id, { resolved: true }, { new: true })
 * 3. Response Sent:
 *    - HTTP 200: Updated SecurityLog JSON object with message "Marked as resolved"
 */
export const resolveSecurityLog = asyncHandler(async (req: Request, res: Response) => {
  const log = await SecurityLog.findByIdAndUpdate(req.params.id, { resolved: true }, { new: true });
  if (!log) throw ApiError.notFound("Log not found");
  sendSuccess(res, log.toJSON(), "Marked as resolved");
});
