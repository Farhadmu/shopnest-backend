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
    type: doc.type,
    title: doc.title,
    message: doc.message,
    isRead: Boolean(doc.isRead),
    link: doc.link,
    relatedId: doc.relatedId,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt ?? doc.createdAt).toISOString(),
  };
}

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const userId = req.user!.id;
  const collection = getCollection();
  const filter = { userId };
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
  const count = await getCollection().countDocuments({ userId: req.user!.id, isRead: { $ne: true } });
  res.json({ success: true, count });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const id = new mongoose.Types.ObjectId(req.params.id);
  const result = await getCollection().findOneAndUpdate(
    { _id: id, userId: req.user!.id },
    { $set: { isRead: true, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) throw ApiError.notFound("Notification not found");
  res.json({ success: true, ...mapNotification(result) });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await getCollection().updateMany(
    { userId: req.user!.id, isRead: { $ne: true } },
    { $set: { isRead: true, updatedAt: new Date() } }
  );
  res.json({ success: true });
});
