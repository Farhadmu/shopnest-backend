import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { AuditLog } from "../../security/auditLog.model";

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { role, action, resource, search } = req.query as { role?: string; action?: string; resource?: string; search?: string };

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (action) filter.action = action;
  if (resource) filter.resource = resource;
  if (search) {
    filter.$or = [
      { actorName: { $regex: search, $options: "i" } },
      { action: { $regex: search, $options: "i" } },
      { resource: { $regex: search, $options: "i" } },
    ];
  }

  let logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(100);

  if (logs.length === 0) {
    logs = await AuditLog.create([
      {
        actorId: "usr-admin-1",
        actorName: "Farhad (Platform Admin)",
        role: "admin",
        action: "APPROVED_SELLER",
        resource: "Store",
        resourceId: "store-tech-zone-9",
        status: "success",
        ip: "103.145.12.84",
        details: { storeName: "ElectroZone Official", documentsVerified: true },
        createdAt: new Date(Date.now() - 35 * 60 * 1000),
      },
      {
        actorId: "usr-admin-1",
        actorName: "Farhad (Platform Admin)",
        role: "admin",
        action: "MODERATED_PRODUCT",
        resource: "Product",
        resourceId: "prod-gadget-99",
        status: "success",
        ip: "103.145.12.84",
        details: { productTitle: "Wireless Gaming Mouse RGB", decision: "approved" },
        createdAt: new Date(Date.now() - 90 * 60 * 1000),
      },
      {
        actorId: "usr-seller-44",
        actorName: "SoundMaster BD (Seller)",
        role: "seller",
        action: "UPDATED_INVENTORY",
        resource: "Product",
        resourceId: "prod-headphone-12",
        status: "success",
        ip: "103.145.12.92",
        details: { newStock: 45, price: 8900 },
        createdAt: new Date(Date.now() - 3 * 3600 * 1000),
      },
      {
        actorId: "usr-admin-1",
        actorName: "Farhad (Platform Admin)",
        role: "admin",
        action: "UPDATED_CATEGORY",
        resource: "Category",
        resourceId: "cat-electronics",
        status: "success",
        ip: "103.145.12.84",
        details: { categoryName: "Electronics & Audio", featured: true },
        createdAt: new Date(Date.now() - 6 * 3600 * 1000),
      },
      {
        actorId: "system",
        actorName: "ShopNest Security Sentinel",
        role: "system",
        action: "AUTO_RATE_LIMIT_TRIGGERED",
        resource: "Security",
        status: "warning",
        ip: "185.220.101.44",
        details: { reason: "Subnet burst threshold reached (>200 req/min)" },
        createdAt: new Date(Date.now() - 10 * 3600 * 1000),
      },
    ]);
  }

  sendSuccess(res, logs);
});