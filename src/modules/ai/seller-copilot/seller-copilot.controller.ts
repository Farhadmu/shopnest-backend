import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { handleSellerCopilotQuery } from "./seller-copilot.service";
import { sellerCopilotQuerySchema } from "./seller-copilot.schemas";
import { CopilotConversation } from "../copilot-conversation.model";

export const sellerCopilotController = asyncHandler(async (req: Request, res: Response) => {
  const { error, data } = sellerCopilotQuerySchema.safeParse(req.body);
  if (error) {
    throw ApiError.badRequest("Invalid request: " + error.errors.map((e) => e.message).join(", "));
  }

  const { query, conversationId } = data as { query: string; conversationId?: string };
  const sellerId = req.user?.id;

  if (!sellerId) {
    throw ApiError.unauthorized("Seller authentication required");
  }

  let conversation = null;
  let history: Array<{ role: string; content: string }> = [];
  if (sellerId) {
    conversation = conversationId
      ? await CopilotConversation.findOne({ _id: conversationId, userId: sellerId, role: "seller" })
      : null;
    if (!conversation) {
      conversation = await CopilotConversation.create({ userId: sellerId, role: "seller", messages: [] });
    }
    conversation.messages.push({ role: "user", content: query, at: new Date() });
    history = conversation.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const response = await handleSellerCopilotQuery(query, sellerId, history);

  if (conversation) {
    conversation.messages.push({ role: "assistant", content: response.answer, at: new Date() });
    await conversation.save();
  }

  sendSuccess(res, { ...response, conversationId: conversation?._id?.toString() });
});
