import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { AnomalyLog } from "../admin-intelligence.model";

export const getAnomalies = asyncHandler(async (_req: Request, res: Response) => {
  const anomalies = await AnomalyLog.find().sort({ detectedAt: -1 });
  sendSuccess(res, anomalies);
});

export const resolveAnomaly = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status = "resolved", notes = "Reviewed and verified by Admin" } = req.body;

  const anomaly = await AnomalyLog.findByIdAndUpdate(
    id,
    { status, resolutionNotes: notes, resolvedAt: new Date(), resolvedBy: req.user?.name || "Admin" },
    { new: true }
  );

  if (!anomaly) throw ApiError.notFound("Anomaly log not found");
  sendSuccess(res, anomaly.toJSON(), "Anomaly status updated");
});

// 30. MARKETPLACE HEALTH INDEX