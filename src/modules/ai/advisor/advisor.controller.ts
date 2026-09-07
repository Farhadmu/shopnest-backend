import { Request, Response } from "express";
import { AiConversation } from "./conversation.model";
import { Product } from "../../products/product.model";
import { complete } from "../providers/claude.provider";
import { SHOPPING_ASSISTANT_SYSTEM, buildProductContext } from "../prompts";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { logAiIncident } from "../incident/incident.service";

/** Very lightweight keyword extraction to pull candidate products before asking the model to reason over them. */
async function findCandidateProducts(message: string) {
  const budgetMatch = message.match(/(\d{2,7})/);
  const maxPrice = budgetMatch ? Number(budgetMatch[1]) : undefined;

  const filter: Record<string, unknown> = { isDeleted: false, status: "approved" };
  if (maxPrice) filter.price = { $lte: maxPrice };

  const textSearch = message.replace(/[^a-zA-Z\s]/g, " ").trim();
  const query = textSearch.length > 0 ? { ...filter, $text: { $search: textSearch } } : filter;

  let products = await Product.find(query).limit(8).select("title price category ratingAvg stock");
  if (products.length === 0) {
    products = await Product.find(filter).sort({ ratingAvg: -1 }).limit(8).select("title price category ratingAvg stock");
  }
  return products.map((p) => ({
    id: p.id,
    title: p.title,
    price: p.discountPrice ?? p.price,
    category: p.category,
    ratingAvg: p.ratingAvg,
    stock: p.stock,
  }));
}

export const chat = asyncHandler(async (req: Request, res: Response) => {
  const { message, conversationId } = req.body as { message: string; conversationId?: string };
  const userId = req.user?.id;

  let conversation = null;
  if (userId) {
    conversation = conversationId
      ? await AiConversation.findOne({ _id: conversationId, userId })
      : null;
    if (!conversation) conversation = await AiConversation.create({ userId, messages: [] });
    conversation.messages.push({ role: "user", content: message, at: new Date() });
  }

  const candidates = await findCandidateProducts(message);
  const context = buildProductContext(candidates);

  const history = conversation ? conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) : [];

  let reply: string;
  let isFallback = false;
  try {
    const result = await complete(
      [...history.slice(0, -1), { role: "user" as const, content: `${context}\n\nCustomer: ${message}` }],
      { system: SHOPPING_ASSISTANT_SYSTEM }
    );
    reply = result.content;
    isFallback = result.isFallback;
  } catch (err) {
    if (userId) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId,
        endpoint: "/ai/chat",
        input: message,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (conversation) {
    conversation.messages.push({ role: "assistant", content: reply, at: new Date() });
    await conversation.save();
  }

  sendSuccess(res, {
    conversationId: conversation?.id,
    reply,
    suggestedProducts: candidates.slice(0, 5),
    isFallback,
  });
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await AiConversation.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  sendSuccess(res, conversation.toJSON());
});
