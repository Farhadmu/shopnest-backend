import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";
import { complete, completeWithContext, AiContext } from "../../ai/providers/claude.provider";
import { logAiIncident } from "../../ai/incident/incident.service";
import { SupportTicket } from "../customer-extras.model";

export const aiSupportChat = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { message } = req.body;
  const recentOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(3);

  let aiResponse = "";
  let suggestedAction = "";
  let isFallback = false;

  const aiContext: AiContext = {
    orders: recentOrders.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount })),
  };

  try {
    const result = await completeWithContext(
      [{ role: "user", content: `Customer: "${message}"\nOrders: ${JSON.stringify(recentOrders.map((o) => ({ id: o.id, status: o.status, total: o.totalAmount })))}` }],
      aiContext,
      { system: "You are ShopNest support AI. Help with orders, delivery, returns. Be concise. If issue needs human help, say so clearly." }
    );
    aiResponse = result.content;
    isFallback = result.isFallback;
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("not arrived") || lowerMsg.includes("late") || lowerMsg.includes("damaged") || lowerMsg.includes("wrong")) suggestedAction = "create_ticket";
  } catch (err) {
    await logAiIncident({ type: "PROVIDER_ERROR", userId, endpoint: "/customer/support/ai-chat", input: message, error: err instanceof Error ? err.message : String(err) });
    aiResponse = recentOrders.length > 0
      ? "I apologize for the trouble. Let me create a support ticket for you."
      : "I'm here to help. Could you please describe your issue?";
    suggestedAction = "create_ticket";
    isFallback = true;
  }

  sendSuccess(res, { response: aiResponse, suggestedAction, isFallback, recentOrders: recentOrders.map((o) => ({ id: o.id, status: o.status })) });
});

export const getSupportTickets = asyncHandler(async (req: Request, res: Response) => {
  const tickets = await SupportTicket.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, tickets);
});

export const createSupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await SupportTicket.create({ userId: req.user!.id, ...req.body, status: "open" });
  sendSuccess(res, ticket, "Support ticket created", 201);
});

// ============================================================
// CUSTOMER LOYALTY & REWARDS (Feature 26)
// ============================================================
