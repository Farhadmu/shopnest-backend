import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { CustomerFraudService } from "./customer-fraud.service";

/**
 * Admin: List all evaluated customer fraud profiles with filters & metrics
 */
export const getFraudCustomers = asyncHandler(async (req: Request, res: Response) => {
  const { search, riskLevel, status, page, limit } = req.query as {
    search?: string;
    riskLevel?: string;
    status?: string;
    page?: string;
    limit?: string;
  };

  const result = await CustomerFraudService.listProfiles({
    search,
    riskLevel,
    status,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });

  sendSuccess(res, result);
});

/**
 * Admin: Get detailed fraud dossier for a customer
 */
export const getCustomerFraudDossier = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const dossier = await CustomerFraudService.getCustomerDossier(userId);
  sendSuccess(res, dossier);
});

/**
 * Admin: Moderation action on customer (COD restriction, blacklist, notes)
 */
export const updateCustomerFraudStatus = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { isCodRestricted, isBlacklisted, adminNotes, reason } = req.body;

  const updated = await CustomerFraudService.updateStatus(
    userId,
    { isCodRestricted, isBlacklisted, adminNotes, reason },
    req.user?.id
  );

  sendSuccess(res, updated, "Customer fraud profile updated successfully");
});

/**
 * Admin: Trigger global fraud scan
 */
export const triggerGlobalFraudScan = asyncHandler(async (_req: Request, res: Response) => {
  const result = await CustomerFraudService.runGlobalFraudScan();
  sendSuccess(res, result);
});

/**
 * Customer-Facing: Retrieve personal trust badge & security shield
 */
export const getMySecurityTrustBadge = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const profile = await CustomerFraudService.evaluateCustomer(userId);

  sendSuccess(res, {
    trustGrade: profile?.trustGrade || "A",
    riskLevel: profile?.riskLevel || "low",
    isCodEligible: !profile?.isCodRestricted,
    totalDeliveries: profile?.deliveredOrders || 0,
    safetyShieldActive: true,
    statusMessage: profile?.isCodRestricted
      ? "Cash on Delivery is limited for your account. Digital payment options are active."
      : "Your account is verified and in good standing with full COD access.",
  });
});
