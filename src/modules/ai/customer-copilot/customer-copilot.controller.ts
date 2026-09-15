import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { handleCustomerCopilotQuery } from "./customer-copilot.service";
import { customerCopilotQuerySchema } from "./customer-copilot.schemas";
import { CopilotConversation } from "../copilot-conversation.model";

export const customerCopilotController = asyncHandler(async (req: Request, res: Response) => {
  const { error, data } = customerCopilotQuerySchema.safeParse(req.body);
  if (error) {
    throw ApiError.badRequest("Invalid request: " + error.errors.map((e) => e.message).join(", "));
  }

  const { query, conversationId } = data as { query: string; conversationId?: string };
  const customerId = req.user?.id;

  if (!customerId) {
    throw ApiError.unauthorized("Customer authentication required");
  }

  let conversation = null;
  let history: Array<{ role: string; content: string }> = [];
  if (customerId) {
    conversation = conversationId
      ? await CopilotConversation.findOne({ _id: conversationId, userId: customerId, role: "customer" })
      : null;
    if (!conversation) {
      conversation = await CopilotConversation.create({ userId: customerId, role: "customer", messages: [] });
    }
    conversation.messages.push({ role: "user", content: query, at: new Date() });
    history = conversation.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const response = await handleCustomerCopilotQuery(query, customerId, history);

  if (conversation) {
    conversation.messages.push({ role: "assistant", content: response.answer, at: new Date() });
    await conversation.save();
  }

  sendSuccess(res, { ...response, conversationId: conversation?._id?.toString() });
});
