import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { CustomerSellerMessage } from "../customer-features.model";

export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: -1 });
  const conversationMap: Record<string, { lastMessage: typeof messages[0]; unreadCount: number; participantId: string }> = {};

  messages.forEach((msg) => {
    if (!conversationMap[msg.conversationId]) conversationMap[msg.conversationId] = { lastMessage: msg, unreadCount: 0, participantId: msg.senderId === userId ? msg.receiverId : msg.senderId };
    if (msg.receiverId === userId && !msg.isRead) conversationMap[msg.conversationId].unreadCount++;
  });

  sendSuccess(res, Object.entries(conversationMap).map(([id, data]) => ({
    conversationId: id, participantId: data.participantId, subject: data.lastMessage.subject,
    lastMessage: data.lastMessage.message, lastMessageAt: data.lastMessage.createdAt, unreadCount: data.unreadCount,
  })));
});

export const getConversationMessages = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ conversationId: req.params.conversationId, $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: 1 });
  await CustomerSellerMessage.updateMany({ conversationId: req.params.conversationId, receiverId: userId, isRead: false }, { isRead: true });
  sendSuccess(res, messages);
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  if (userRole !== "customer") throw ApiError.forbidden("Only customers can initiate messages");

  const { receiverId, orderId, productId, subject, message } = req.body;
  const conversationId = [userId, receiverId].sort().join("_") + (orderId ? `_${orderId}` : "");

  const msg = await CustomerSellerMessage.create({
    conversationId, senderId: userId, senderRole: "customer", receiverId, receiverRole: "seller",
    orderId, productId, subject, message, isRead: false,
  });
  sendSuccess(res, msg, "Message sent", 201);
});

export const reportMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const msg = await CustomerSellerMessage.findOneAndUpdate(
    { _id: req.params.id, $or: [{ senderId: userId }, { receiverId: userId }] },
    { isReported: true, reportReason: req.body.reason }
  );
  if (!msg) throw ApiError.notFound("Message not found");
  sendSuccess(res, { success: true }, "Message reported successfully");
});

// ============================================================
// SMART CUSTOMER SUPPORT (Feature 25)
// ============================================================
