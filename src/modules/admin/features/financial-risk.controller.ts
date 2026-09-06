import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { calculateFinancialRisk } from "../risk.service";

export const getFinancialRisk = asyncHandler(async (_req: Request, res: Response) => {
  const financialData = await calculateFinancialRisk();
  sendSuccess(res, financialData);
});

// 37d. FRAUD ALERTS