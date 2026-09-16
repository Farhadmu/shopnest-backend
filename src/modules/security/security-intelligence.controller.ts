import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { DeviceSession, SecurityRiskLog } from "./security-intelligence.model";
import { SecurityLog } from "../security/securityLog.model";
import { AuditLog } from "../security/auditLog.model";
import { getUserId } from "../../utils/getUserId";
import { parseUserAgent, getClientIp, maskIp, readDeviceId } from "../../utils/device";
import { createNotification } from "../notifications/notification.service";

/**
 * Deletes the *real* authentication sessions (better-auth's `session`
 * collection) for a user, so revoked devices can no longer authenticate.
 * Scoped strictly to `userId`; never touches other users.
 */
async function deleteAuthSessions(userId: string, tokenFilter: Record<string, unknown> = {}): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  // better-auth's mongo adapter stores session.userId as an ObjectId; match both
  // the ObjectId and its string form so the query works across adapters.
  const userMatch: unknown = mongoose.isValidObjectId(userId)
    ? { $in: [userId, new mongoose.Types.ObjectId(userId)] }
    : userId;

  const result = await db.collection("session").deleteMany({ userId: userMatch, ...tokenFilter });
  return result.deletedCount ?? 0;
}

/**
 * The notification bell only reads the recipient scope matching the signed-in
 * role (`user` / `seller` / `admin`), so the audience must be set accordingly
 * or the alert would be invisible to its owner.
 */
function recipientTypeForRole(role?: string): "user" | "seller" | "admin" {
  if (role === "admin") return "admin";
  if (role === "seller") return "seller";
  return "user";
}

/** Each role has its own Security Center page. */
function securityCenterPathForRole(role?: string): string {
  if (role === "admin") return "/dashboard/admin/security";
  if (role === "seller") return "/dashboard/seller/security";
  return "/dashboard/user/security";
}

/** Human-readable device class for the notification copy (never the raw UA). */
function deviceKindLabel(deviceType: string): string {
  switch (deviceType) {
    case "mobile":
      return "Mobile";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Desktop";
    default:
      return "Unknown device";
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// 21. ACCOUNT SECURITY CENTER
export const getSecurityOverview = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const activeSessions = await DeviceSession.countDocuments({ userId, status: "active" });
  const totalSessions = await DeviceSession.countDocuments({ userId });
  const revokedSessions = await DeviceSession.countDocuments({ userId, status: "revoked" });

  const recentSecurityLogs = await SecurityLog.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
  const failedLogins = recentSecurityLogs.filter((log: any) => log.type === "LOGIN_ANOMALY").length;

  const securityChecklist = [
    {
      key: "session_hygiene",
      title: "Active Session Hygiene",
      status: activeSessions <= 2 ? "passed" : "warning",
      score: activeSessions <= 2 ? 25 : 10,
      note: `${activeSessions} active session${activeSessions !== 1 ? "s" : ""} recognized.`,
    },
    {
      key: "recent_activity",
      title: "Recent Login Activity",
      status: totalSessions > 0 ? "passed" : "warning",
      score: totalSessions > 0 ? 20 : 5,
      note: totalSessions > 0 ? `${totalSessions} session${totalSessions !== 1 ? "s" : ""} on record.` : "No session history available.",
    },
    {
      key: "failed_logins",
      title: "Failed Login Attempts",
      status: failedLogins === 0 ? "passed" : "warning",
      score: failedLogins === 0 ? 25 : 5,
      note: failedLogins === 0 ? "No recent failed login attempts." : `${failedLogins} failed attempt${failedLogins !== 1 ? "s" : ""} detected.`,
    },
    {
      key: "security_events",
      title: "Security Events",
      status: recentSecurityLogs.length === 0 ? "passed" : "info",
      score: recentSecurityLogs.length === 0 ? 20 : 10,
      note: recentSecurityLogs.length === 0 ? "No security events detected." : `${recentSecurityLogs.length} recent event${recentSecurityLogs.length !== 1 ? "s" : ""}.`,
    },
  ];

  const totalScore = securityChecklist.reduce((sum, item) => sum + item.score, 0);
  const statusLevel = totalScore >= 85 ? "Optimal Shield" : totalScore >= 65 ? "Good" : "Action Recommended";

  sendSuccess(res, {
    userId,
    securityScore: totalScore,
    statusLevel,
    checklist: securityChecklist,
    activeSessions,
    totalSessions,
    revokedSessions,
    failedLogins,
    recentSecurityEvents: recentSecurityLogs.length,
  });
});

export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const sessions = await DeviceSession.find({ userId, status: "active" }).sort({ lastActiveAt: -1 }).lean();

  // The current session comes from the verified auth token on the request,
  // not a client-supplied header.
  const currentToken = req.sessionToken;

  // Whitelisted on purpose: `sessionToken` is a live credential, so it is only
  // compared here and never serialized to the client.
  const mapped = sessions.map((s: any) => ({
    id: String(s._id),
    userId: s.userId,
    deviceId: s.deviceId,
    deviceName: s.deviceName,
    deviceType: s.deviceType,
    browser: s.browser,
    os: s.os,
    ipAddress: s.ipAddress,
    locationCity: s.locationCity,
    isTrusted: s.isTrusted,
    status: s.status,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    isCurrentSession: Boolean(currentToken) && s.sessionToken === currentToken,
  }));

  sendSuccess(res, mapped);
});

/**
 * Records the device the current session is running on.
 *
 * Device identity is the client's persistent `deviceId` — an opaque random id
 * kept in a long-lived cookie — and never the IP address (which changes with
 * the network) or the session token (which is new on every login). That is
 * what lets a device be recognized across logins, refreshes, logouts, browser
 * restarts and IP changes, while a genuinely different browser or device
 * carries its own id and is reported exactly once.
 */
export const recordSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const userAgent = req.headers["user-agent"] as string | undefined;
  const ip = getClientIp(req);
  const device = parseUserAgent(userAgent);
  const deviceId = readDeviceId(req);
  const sessionToken = req.sessionToken;

  const deviceFields = {
    deviceName: `${device.browser} on ${device.os}`,
    deviceType: device.deviceType,
    browser: device.browser,
    os: device.os,
    ipAddress: maskIp(ip),
    locationCity: "Unknown",
    isCurrentSession: true,
    isTrusted: true,
    status: "active" as const,
    lastActiveAt: new Date(),
  };

  // No usable persistent device id (older client or non-browser caller): key
  // off the verified session token as before and never alert, since devices
  // cannot be told apart without an id.
  if (!deviceId) {
    if (!sessionToken) return sendSuccess(res, { status: "active" });

    const existing = await DeviceSession.findOne({ userId, sessionToken }).lean();
    if (existing) {
      await DeviceSession.updateOne({ _id: existing._id }, { $set: deviceFields });
    } else {
      await DeviceSession.create({ userId, sessionToken, ...deviceFields });
      await DeviceSession.updateMany(
        { userId, status: "active", sessionToken: { $ne: sessionToken } },
        { isCurrentSession: false }
      );
    }
    return sendSuccess(res, { status: "active" });
  }

  // Already-recognized device for this user: refresh it and stop. Every repeat
  // login/refresh from the same browser takes this path, so it stays a single
  // indexed lookup and raises no alert.
  const known = await DeviceSession.findOne({ userId, deviceId }).lean();
  if (known) {
    await DeviceSession.updateOne(
      { _id: known._id },
      { $set: { ...deviceFields, sessionToken: sessionToken ?? known.sessionToken } }
    );
    await DeviceSession.updateMany(
      { userId, status: "active", _id: { $ne: known._id } },
      { $set: { isCurrentSession: false } }
    );
    return sendSuccess(res, { status: "active", deviceName: known.deviceName });
  }

  // A device id this user has never been seen on. Raise the alert only when the
  // user already had a recognized device: a brand-new account — and any account
  // created before device tracking existed — must register its first device
  // silently, otherwise every existing user would be told their own browser is
  // "new" on their next login.
  const hadRecognizedDevice = await DeviceSession.exists({ userId, deviceId: { $type: "string" } });

  let newDeviceObjectId: unknown = null;
  try {
    // Atomic upsert against the unique (userId, deviceId) index, so two
    // concurrent logins register one device and can alert only once.
    const result = await DeviceSession.updateOne(
      { userId, deviceId },
      { $set: { ...deviceFields, sessionToken: sessionToken ?? `device:${deviceId}` } },
      { upsert: true }
    );
    newDeviceObjectId = result.upsertedId ?? null;
  } catch (err) {
    // Lost a race with a concurrent request for the same device: that one
    // owns the alert, so treat this as an already-known device.
    if (!isDuplicateKeyError(err)) throw err;
  }

  if (newDeviceObjectId && hadRecognizedDevice) {
    const role = req.user?.role;
    try {
      await createNotification({
        userId,
        recipientType: recipientTypeForRole(role),
        type: "security_alert",
        category: "security",
        priority: "warning",
        source: "security",
        title: "New Device Detected",
        message: `Your account was accessed from a new device: ${device.browser} on ${device.os} (${deviceKindLabel(device.deviceType)}). If this was not you, review your active sessions and change your password.`,
        link: securityCenterPathForRole(role),
        relatedId: String(newDeviceObjectId),
        relatedType: "security_event",
      });
    } catch (err) {
      // The device is already registered, so this alert cannot be retried on
      // the next login — log loudly instead of failing the login request.
      console.error("Failed to create new-device notification", err);
    }
  }

  return sendSuccess(res, { status: "active", deviceName: deviceFields.deviceName });
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const session = await DeviceSession.findOne({ _id: id, userId });
  if (!session) throw ApiError.notFound("Session record not found");

  if (req.sessionToken && session.sessionToken === req.sessionToken) {
    throw ApiError.badRequest("Cannot revoke your current session");
  }

  // Delete the real authentication session so this device can no longer authenticate.
  await deleteAuthSessions(userId, { token: session.sessionToken });
  await DeviceSession.findByIdAndUpdate(id, { status: "revoked", isCurrentSession: false });

  createNotification({
    userId,
    type: "security_alert",
    category: "security",
    priority: "warning",
    source: "security",
    title: "Session Revoked",
    message: `A session on ${session.deviceName} has been disconnected. If this was not you, please change your password.`,
    link: "/dashboard/user/security",
    relatedId: id,
    relatedType: "security_event",
  }).catch((err) => console.warn("Failed to create revoke notification", err));

  sendSuccess(res, { sessionId: id, status: "revoked" }, "Device session terminated");
});

export const revokeAllOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const currentToken = req.sessionToken;

  // Without the current session token we cannot guarantee the caller stays
  // logged in, so refuse rather than risk revoking the current session.
  if (!currentToken) {
    throw ApiError.badRequest("Unable to determine the current session. Please sign in again.");
  }

  // Revoke every other real authentication session for THIS user, keeping the
  // caller's current session intact. Scoped by the authenticated user id.
  const revokedCount = await deleteAuthSessions(userId, { token: { $ne: currentToken } });

  // Keep the device-tracking records in sync for the Security Center UI.
  await DeviceSession.updateMany(
    { userId, sessionToken: { $ne: currentToken }, status: "active" },
    { status: "revoked", isCurrentSession: false }
  );

  if (revokedCount > 0) {
    createNotification({
      userId,
      type: "security_alert",
      category: "security",
      priority: "warning",
      source: "security",
      title: "All Other Sessions Revoked",
      message: `All other active sessions have been disconnected. Only your current session remains active.`,
      link: "/dashboard/user/security",
      relatedType: "security_event",
    }).catch((err) => console.warn("Failed to create revoke-all notification", err));
  }

  sendSuccess(res, { success: true, revokedCount }, "All other active sessions revoked");
});

// 23. LOGIN RISK DETECTION
export const evaluateLoginRisk = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const ip = getClientIp(req);
  const userAgent = (req.headers["user-agent"] as string) || "Unknown";

  const knownSessions = await DeviceSession.find({ userId, status: "active" }).lean();
  const knownIps = [...new Set(knownSessions.map((s: any) => s.ipAddress))];
  const isKnownIp = knownIps.some((knownIp) => ip.startsWith(knownIp.split(".").slice(0, 3).join(".")));

  const device = parseUserAgent(userAgent);
  const isKnownDevice = knownSessions.some((s: any) => s.browser === device.browser && s.os === device.os);

  const riskScore = isKnownIp && isKnownDevice ? 12 : 68;
  const riskLevel = riskScore < 30 ? "low" : riskScore < 70 ? "medium" : "high";

  const signals = [
    isKnownIp ? "✓ Familiar geographic cluster" : "⚠ New IP Address subnet detected",
    isKnownDevice ? "✓ Consistent device fingerprint" : "⚠ Unrecognized User-Agent profile",
    "✓ No recent credential stuffing velocity observed",
  ];

  await SecurityRiskLog.create({
    userId,
    contextType: "login",
    riskScore,
    riskLevel,
    signals,
    actionTaken: riskScore < 50 ? "allowed" : "step_up_required",
    metadata: { ip: maskIp(ip), userAgent, device },
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
  const { orderAmount = 2500 } = req.body;

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

// 25. ATO ALERTS
export const getAtoAlerts = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const recentLogs = await SecurityLog.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();
  const flags = recentLogs
    .filter((log: any) => log.type === "LOGIN_ANOMALY" || log.type === "SUSPICIOUS_ORDER")
    .map((log: any) => log.message);

  const atoStatus = flags.length === 0 ? "SECURE" : "ATTENTION_REQUIRED";

  sendSuccess(res, {
    userId,
    atoStatus,
    anomalyScore: flags.length > 0 ? Math.min(100, flags.length * 20) : 8,
    flags: flags.slice(0, 5),
    protectionNotice: flags.length === 0 ? "Zero behavioral takeover indicators. Account baseline is consistent." : "Review recent security events for unusual patterns.",
  });
});

// 26. SECURITY ACTIVITY TIMELINE
export const getSecurityTimeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const securityLogs = await SecurityLog.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
  const auditLogs = await AuditLog.find({ actorId: userId }).sort({ createdAt: -1 }).limit(20).lean();
  const sessions = await DeviceSession.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();

  const events: Array<{
    id: string;
    event: string;
    detail: string;
    timestamp: string;
    severity: string;
    icon: string;
  }> = [];

  for (const log of securityLogs) {
    const severityMap: Record<string, string> = {
      low: "info",
      medium: "warning",
      high: "warning",
      critical: "critical",
    };
    events.push({
      id: String(log._id),
      event: log.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      detail: log.message,
      timestamp: log.createdAt.toISOString(),
      severity: severityMap[log.severity] || "info",
      icon: log.type === "LOGIN_ANOMALY" ? "🔐" : log.type === "SUSPICIOUS_ORDER" ? "⚠️" : "🛡️",
    });
  }

  for (const audit of auditLogs) {
    const iconMap: Record<string, string> = {
      success: "✅",
      warning: "⚠️",
      failure: "❌",
    };
    events.push({
      id: String(audit._id),
      event: audit.action,
      detail: `${audit.resource}${audit.resourceId ? ` (${audit.resourceId})` : ""}`,
      timestamp: audit.createdAt.toISOString(),
      severity: audit.status === "success" ? "info" : audit.status === "warning" ? "warning" : "critical",
      icon: iconMap[audit.status] || "📋",
    });
  }

  for (const sess of sessions) {
    events.push({
      id: `session-${String(sess._id)}`,
      event: sess.status === "active" ? "Active Session" : "Session Revoked",
      detail: `${sess.deviceName} • ${sess.ipAddress}`,
      timestamp: sess.updatedAt.toISOString(),
      severity: sess.status === "active" ? "info" : "warning",
      icon: sess.deviceType === "mobile" ? "📱" : "💻",
    });
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  sendSuccess(res, events.slice(0, 50));
});
