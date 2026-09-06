import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { detectSuspiciousOrders } from "../risk.service";

export const getSuspiciousOrders = asyncHandler(async (req: Request, res: Response) => {
  const { range = "30d", page = 1, limit = 20 } = req.query as { range?: string; page?: string; limit?: string };

  const rangeMs = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[range] || 30 * 24 * 60 * 60 * 1000;

  const allSuspicious = await detectSuspiciousOrders(rangeMs);
  const skip = (Number(page) - 1) * Number(limit);
  const paginated = allSuspicious.slice(skip, skip + Number(limit));

  sendSuccess(res, {
    orders: paginated,
    pagination: {
      total: allSuspicious.length,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(allSuspicious.length / Number(limit)),
    },
  });
});

// 37c. FINANCIAL RISK EXPOSURE