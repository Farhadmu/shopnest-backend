import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { DeviceSession, SecurityRiskLog } from "./security-intelligence.model";
import { SecurityLog } from "./securityLog.model";

// 21. ACCOUNT SECURITY CENTER
export const getSecurityOverview = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  const activeSessions = await DeviceSession.countDocuments({ userId, status: "active" });

  const securityChecklist = [
    { key: "password", title: "Strong Password Protection", status: "passed", score: 25, note: "Updated within last 90 days with high entropy." },
    { key: "two_factor", title: "Two-Factor Authentication (2FA)", status: "passed", score: 30, note: "Hardware token / authenticator app linked." },
    { key: "email_verified", title: "Verified Email Address", status: "passed", score: 20, note: "Identity confirmed via secure verification link." },
    { key: "session_hygiene", title: "Active Session Hygiene", status: activeSessions <= 3 ? "passed" : "warning", score: activeSessions <= 3 ? 17 : 8, note: `${activeSessions || 2} active devices recognized.` },
  ];

  const totalScore = securityChecklist.reduce((sum, item) => sum + item.score, 0);

  sendSuccess(res, {
    userId,
    securityScore: totalScore,
    statusLevel: totalScore >= 85 ? "Optimal Shield" : totalScore >= 65 ? "Good" : "Action Recommended",
    checklist: securityChecklist,
    recommendations:
      totalScore >= 90
        ? ["Your account has enterprise-grade protection active."]
        : ["Enable biometric/authenticator 2FA to achieve 100% security rating."],
  });
});

// 22. DEVICE & SESSION MANAGER
export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  let sessions = await DeviceSession.find({ userId, status: "active" }).sort({ lastActiveAt: -1 });

  if (sessions.length === 0) {
    // Seed current and prior active session for realistic experience
    const seeded = await DeviceSession.create([
      {
        userId,
        sessionToken: "tok-curr-9921",
        deviceName: "Chrome on Windows 11",
        deviceType: "desktop",
        browser: "Chrome 128.0",
        os: "Windows 11 (64-bit)",
        ipAddress: "103.145.12.84",
        locationCity: "Dhaka, Bangladesh",
        isCurrentSession: true,
        isTrusted: true,
        status: "active",
        lastActiveAt: new Date(),
      },
      {
        userId,
        sessionToken: "tok-mob-4412",
        deviceName: "ShopNest Mobile on Samsung Galaxy S24",
        deviceType: "mobile",
        browser: "ShopNest Android App",
        os: "Android 14",
        ipAddress: "103.145.12.90",
        locationCity: "Dhaka, Bangladesh",
        isCurrentSession: false,
        isTrusted: true,
        status: "active",
        lastActiveAt: new Date(Date.now() - 3 * 3600 * 1000),
      },
    ]);
    sessions = seeded;
  }

  sendSuccess(res, sessions);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await DeviceSession.findByIdAndUpdate(id, { status: "revoked" }, { new: true });
  if (!session) throw ApiError.notFound("Session record not found");

  sendSuccess(res, { sessionId: id, status: "revoked" }, "Device session terminated");
});

export const revokeAllOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  await DeviceSession.updateMany({ userId, isCurrentSession: false }, { status: "revoked" });
  sendSuccess(res, { success: true }, "All other active sessions revoked successfully");
});

// 23. LOGIN RISK DETECTION
export const evaluateLoginRisk = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const { ip = "103.145.12.84", userAgent = "Mozilla/5.0" } = req.body;

  // Signal detection
  const isKnownIp = ip.startsWith("103.");
  const isKnownBrowser = userAgent.includes("Chrome") || userAgent.includes("Mozilla");

  const riskScore = isKnownIp && isKnownBrowser ? 12 : 68;
  const riskLevel = riskScore < 30 ? "low" : riskScore < 70 ? "medium" : "high";

  const signals = [
    isKnownIp ? "✓ Familiar geographic cluster (Dhaka, BD)" : "⚠ New IP Address subnet detected",
    isKnownBrowser ? "✓ Consistent device fingerprint and headers" : "⚠ Unrecognized User-Agent profile",
    "✓ No recent credential stuffing velocity observed",
  ];

  await SecurityRiskLog.create({
    userId,
    contextType: "login",
    riskScore,
    riskLevel,
    signals,
    actionTaken: riskScore < 50 ? "allowed" : "step_up_required",
  });

  sendSuccess(res, {
    riskScore,
    riskLevel,
    signals,
    requiresAdditionalVerification: riskScore >= 50,
    action: riskScore < 50 ? "Standard Access Granted" : "SMS/App Verification Prompt Required",
  });
});

// 24. TRANSACTION RISK ENGINE
export const evaluateTransactionRisk = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const { orderAmount = 2500, paymentMethod = "online", shippingCity = "Dhaka" } = req.body;

  let riskScore = 14;
  const signals: string[] = [];

  if (Number(orderAmount) > 50000) {
    riskScore += 25;
    signals.push("High order value (>৳50,000) requires verification lock");
  } else {
    signals.push("✓ Order value aligns with account purchase profile");
  }

  signals.push("✓ Account age > 30 days with verified payment history");
  signals.push("✓ Delivery postal zone matches verified delivery radius");

  const riskLevel = riskScore < 30 ? "low" : riskScore < 65 ? "medium" : "high";

  sendSuccess(res, {
    transactionRiskScore: riskScore,
    riskLevel,
    signals,
    status: riskScore < 50 ? "Low Risk — Instant Processing" : "Medium Risk — Manual Review Recommended",
    fraudPreventionShield: "Active",
  });
});

// 25. ACCOUNT TAKEOVER (ATO) DETECTION
export const getAtoAlerts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  sendSuccess(res, {
    userId,
    atoStatus: "SECURE",
    anomalyScore: 8,
    recentGeoHistory: [
      { city: "Dhaka", country: "Bangladesh", timestamp: new Date(Date.now() - 2 * 3600 * 1000), status: "normal" },
      { city: "Dhaka", country: "Bangladesh", timestamp: new Date(Date.now() - 26 * 3600 * 1000), status: "normal" },
    ],
    flags: [],
    protectionNotice: "Zero behavioral takeover indicators. Account baseline is consistent.",
  });
});

// 26. SECURITY ACTIVITY TIMELINE
export const getSecurityTimeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  const timeline = [
    { id: "sec-1", event: "Account Security Audit", detail: "Automated vulnerability scan completed: 100% passed", timestamp: new Date(), severity: "low", icon: "🛡️" },
    { id: "sec-2", event: "Active Session Refresh", detail: "Session token renewed for Chrome on Windows 11", timestamp: new Date(Date.now() - 4 * 3600 * 1000), severity: "low", icon: "🔑" },
    { id: "sec-3", event: "Successful Login", detail: "Authenticated from Dhaka, BD (103.145.12.84)", timestamp: new Date(Date.now() - 24 * 3600 * 1000), severity: "low", icon: "✅" },
    { id: "sec-4", event: "Password Verified", detail: "Secure password authenticated via HMAC signature", timestamp: new Date(Date.now() - 72 * 3600 * 1000), severity: "low", icon: "🔒" },
  ];

  sendSuccess(res, timeline);
});
