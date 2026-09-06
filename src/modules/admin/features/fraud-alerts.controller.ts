import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { detectFraudAlerts } from "../risk.service";

export const getFraudAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { range = "30d" } = req.query as { range?: string };

  const rangeMs = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[range] || 30 * 24 * 60 * 60 * 1000;

  const alerts = await detectFraudAlerts(rangeMs);

  sendSuccess(res, {
    alerts,
    total: alerts.length,
    byRiskLevel: {
      critical: alerts.filter((a) => a.riskLevel === "critical").length,
      high: alerts.filter((a) => a.riskLevel === "high").length,
      medium: alerts.filter((a) => a.riskLevel === "medium").length,
      low: alerts.filter((a) => a.riskLevel === "low").length,
    },
  });
});

// 38. SECURITY INCIDENT MANAGEMENT