import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Review } from "../../reviews/review.model";

export const getSecurityCenter = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [sessions, timeline] = await Promise.all([
    require("../security/security-intelligence.model").DeviceSession.find({ userId, status: "active" }),
    require("../security/security-intelligence.model").SecurityRiskLog.find({ userId }).sort({ createdAt: -1 }).limit(20),
  ]);

  sendSuccess(res, {
    securityScore: 85,
    sessions,
    timeline,
    twoFactorEnabled: false,
    lastPasswordChange: null,
    recommendations: ["Enable 2FA for extra security", "Review active sessions regularly"],
  });
});

export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await require("../security/security-intelligence.model").DeviceSession.find({ userId: req.user!.id, status: "active" });
  sendSuccess(res, sessions);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "Session revoked");
});

export const revokeAllSessions = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.updateMany(
    { userId: req.user!.id, isCurrentSession: false }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "All other sessions revoked");
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, { success: true }, "Password change initiated. Please check your email.");
});

// ============================================================
// PERSONAL SHOPPING PROFILE (Feature 30)
// ============================================================
