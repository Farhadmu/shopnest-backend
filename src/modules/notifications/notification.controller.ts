import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/async-handler";
import { ApiError } from "../../utils/api-error";

function getCollection() {
  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database is not connected");
  return db.collection("notifications");
}

function mapNotification(doc: any) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    recipientType: doc.recipientType,
    type: doc.type,
    category: doc.category,
    priority: doc.priority,
    source: doc.source,
    title: doc.title,
    message: doc.message,
    isRead: Boolean(doc.isRead),
    link: doc.link,
    relatedId: doc.relatedId,
    relatedType: doc.relatedType,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt ?? doc.createdAt).toISOString(),
  };
}

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const { category, source, isRead, search } = req.query as {
    category?: string;
    source?: string;
    isRead?: string;
    search?: string;
  };

  const collection = getCollection();
  const filter: Record<string, unknown> = { userId };

  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") {
    allowedRecipientTypes.add("admin");
  } else if (userRole === "seller") {
    allowedRecipientTypes.add("seller");
  } else {
    allowedRecipientTypes.add("user");
  }
  filter.recipientType = { $in: Array.from(allowedRecipientTypes) };

  if (category) filter.category = category;
  if (source) filter.source = source;
  if (isRead !== undefined) filter.isRead = isRead === "true";

  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { title: regex },
      { message: regex },
      { type: regex },
    ];
  }

  const [docs, total] = await Promise.all([
    collection.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  res.json({
    success: true,
    items: docs.map(mapNotification),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") {
    allowedRecipientTypes.add("admin");
  } else if (userRole === "seller") {
    allowedRecipientTypes.add("seller");
  } else {
    allowedRecipientTypes.add("user");
  }
  const count = await getCollection().countDocuments({ userId, recipientType: { $in: Array.from(allowedRecipientTypes) }, isRead: { $ne: true } });
  res.json({ success: true, count });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const id = new mongoose.Types.ObjectId(req.params.id);
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") allowedRecipientTypes.add("admin");
  else if (userRole === "seller") allowedRecipientTypes.add("seller");
  else allowedRecipientTypes.add("user");

  const result = await getCollection().findOneAndUpdate(
    { _id: id, userId, recipientType: { $in: Array.from(allowedRecipientTypes) } },
    { $set: { isRead: true, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) throw ApiError.notFound("Notification not found");
  res.json({ success: true, ...mapNotification(result) });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") allowedRecipientTypes.add("admin");
  else if (userRole === "seller") allowedRecipientTypes.add("seller");
  else allowedRecipientTypes.add("user");

  await getCollection().updateMany(
    { userId, recipientType: { $in: Array.from(allowedRecipientTypes) }, isRead: { $ne: true } },
    { $set: { isRead: true, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  const id = new mongoose.Types.ObjectId(req.params.id);
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") allowedRecipientTypes.add("admin");
  else if (userRole === "seller") allowedRecipientTypes.add("seller");
  else allowedRecipientTypes.add("user");

  const result = await getCollection().findOneAndDelete({ _id: id, userId, recipientType: { $in: Array.from(allowedRecipientTypes) } });
  if (!result) throw ApiError.notFound("Notification not found");
  res.json({ success: true, deleted: true });
});

export const clearReadNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = (req.user as { role?: string } | undefined)?.role;
  const allowedRecipientTypes = new Set<string>(["all"]);
  if (userRole === "admin") allowedRecipientTypes.add("admin");
  else if (userRole === "seller") allowedRecipientTypes.add("seller");
  else allowedRecipientTypes.add("user");

  const result = await getCollection().deleteMany({ userId, recipientType: { $in: Array.from(allowedRecipientTypes) }, isRead: true });
  res.json({ success: true, deleted: result.deletedCount });
});

function ensureAdmin(req: Request) {
  if (req.user?.role !== "admin") {
    throw ApiError.forbidden("Admin access required");
  }
}

export const listAdminNotifications = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const { status, priority, category, source, search, sortBy = "createdAt", sortDir = "-1" } = req.query as {
    status?: string;
    priority?: string;
    category?: string;
    source?: string;
    search?: string;
    sortBy?: string;
    sortDir?: string;
  };

  const collection = getCollection();
  const filter: Record<string, unknown> = {};

  if (status === "unread") filter.isRead = false;
  else if (status === "read") filter.isRead = true;

  if (priority) filter.priority = priority;
  if (category) filter.category = category;
  if (source) filter.source = source;

  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { title: regex },
      { message: regex },
      { type: regex },
    ];
  }

  const sortField = sortBy || "createdAt";
  const sortOrder = sortDir === "1" ? 1 : -1;

  const [docs, total] = await Promise.all([
    collection.find(filter).sort({ [sortField]: sortOrder }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  res.json({
    success: true,
    items: docs.map(mapNotification),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export const getAdminNotificationStats = asyncHandler(async (_req: Request, res: Response) => {
  ensureAdmin(_req);
  const collection = getCollection();

  const [total, unread, critical, high, today, byCategory, byPriority] = await Promise.all([
    collection.countDocuments({}),
    collection.countDocuments({ isRead: false }),
    collection.countDocuments({ priority: "critical", isRead: false }),
    collection.countDocuments({ priority: "high", isRead: false }),
    collection.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    collection.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]).toArray(),
    collection.aggregate([
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  res.json({
    success: true,
    total,
    unread,
    critical,
    high,
    today,
    byCategory: byCategory.reduce((acc: Record<string, number>, item: any) => ({ ...acc, [item._id || "unknown"]: item.count }), {}),
    byPriority: byPriority.reduce((acc: Record<string, number>, item: any) => ({ ...acc, [item._id || "info"]: item.count }), {}),
  });
});

export const getAdminUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  const count = await getCollection().countDocuments({ isRead: false });
  res.json({ success: true, count });
});

export const markAdminNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  const id = new mongoose.Types.ObjectId(req.params.id);
  const result = await getCollection().findOneAndUpdate(
    { _id: id },
    { $set: { isRead: true, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) throw ApiError.notFound("Notification not found");
  res.json({ success: true, ...mapNotification(result) });
});

export const markAdminNotificationUnread = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  const id = new mongoose.Types.ObjectId(req.params.id);
  const result = await getCollection().findOneAndUpdate(
    { _id: id },
    { $set: { isRead: false, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) throw ApiError.notFound("Notification not found");
  res.json({ success: true, ...mapNotification(result) });
});

export const markAllAdminNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  await getCollection().updateMany(
    { isRead: { $ne: true } },
    { $set: { isRead: true, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

export const bulkMarkAdminNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  ensureAdmin(req);
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    throw ApiError.badRequest("ids array is required");
  }
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id)).filter(Boolean);
  await getCollection().updateMany(
    { _id: { $in: objectIds } },
    { $set: { isRead: true, updatedAt: new Date() } }
  );
  res.json({ success: true, modified: objectIds.length });
});
