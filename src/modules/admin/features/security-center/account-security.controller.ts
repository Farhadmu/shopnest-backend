import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { ApiError } from "../../../../utils/api-error";
import { SecurityLog } from "../../../security/securityLog.model";
import { AuditLog } from "../../../security/auditLog.model";

// 5. ACCOUNT SECURITY
export const getAccountSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { status, search, page = 1, limit = 20 } = req.query as {
    status?: string; search?: string; page?: string; limit?: string;
  };

  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const [users, total, suspendedCount, blockedCount, recentRegistrations] = await Promise.all([
    db.collection("user").find(filter).skip(skip).limit(Number(limit)).sort({ createdAt: -1 }).toArray(),
    db.collection("user").countDocuments(filter),
    db.collection("user").countDocuments({ status: "suspended" }),
    db.collection("user").countDocuments({ status: "blocked" }),
    db.collection("user").countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);

  const suspiciousUserIds = await SecurityLog.distinct("userId", {
    severity: { $in: ["high", "critical"] },
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  });

  sendSuccess(res, {
    users: users.map((u: any) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role || "customer",
      status: u.status || "active",
      createdAt: u.createdAt,
      hasSecurityActivity: suspiciousUserIds.some((id) => id?.toString() === u._id?.toString()),
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: {
      total,
      suspended: suspendedCount,
      blocked: blockedCount,
      active: total - suspendedCount - blockedCount,
      recentRegistrations,
      flaggedForReview: suspiciousUserIds.length,
    },
  });
});

// Update user status (suspend/activate/block)
export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!["active", "suspended", "blocked"].includes(status)) {
    throw ApiError.badRequest("Invalid status value");
  }

  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection unavailable");

  const result = await db.collection("user").updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { status, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) throw ApiError.notFound("User not found");

  await AuditLog.create({
    actorId: req.user?.id || "system",
    actorName: req.user?.name || "Admin",
    role: "admin",
    action: status === "suspended" ? "SUSPENDED_USER" : status === "blocked" ? "BLOCKED_USER" : "ACTIVATED_USER",
    resource: "User",
    resourceId: id,
    status: "success",
    details: { reason },
  });

  sendSuccess(res, { id, status }, `User ${status} successfully`);
});
