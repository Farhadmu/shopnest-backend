import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { complete, completeWithContext, AiContext } from "../../ai/providers/claude.provider";
import { UserPreferences } from "../customer-features.model";
import { ShoppingGoal } from "../customer-intelligence.model";

export const askPersonalCommerceAssistant = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    throw ApiError.badRequest("Prompt is required");
  }

  // Fetch authorized context for this customer only
  const [orders, wishlist, preferences, goals] = await Promise.all([
    Order.find({ customerId: userId }).sort({ createdAt: -1 }).limit(5),
    Wishlist.findOne({ userId }),
    UserPreferences.findOne({ userId }),
    ShoppingGoal.find({ userId }).limit(3),
  ]);

  let wishProducts: string[] = [];
  if (wishlist && wishlist.items.length) {
    const prods = await Product.find({ _id: { $in: wishlist.items.map((i) => i.productId) } });
    wishProducts = prods.map((p) => `${p.title} (৳${p.discountPrice ?? p.price})`);
  }

  const orderSummary = orders.map((o) => `Order #${String(o._id).slice(-6)} - ৳${o.totalAmount} (${o.status})`).join(", ");

  const systemContext = `
You are ShopNest Personal Commerce Copilot for ${req.user!.name || "the customer"}.
You have authorized access to ONLY this customer's private shopping data:
- Recent Orders: ${orderSummary || "No orders yet"}
- Wishlist Products: ${wishProducts.join(", ") || "Wishlist is currently empty"}
- Typical Budget: ৳${preferences?.typicalBudgetMax || 30000}
- Active Goals: ${goals.map((g) => `${g.title} (Budget: ৳${g.targetBudget})`).join(", ") || "None"}

Provide helpful, accurate, friendly, and concise responses in English/Bangla as prompted. Never fabricate orders.
`;

  const aiContext: AiContext = {
    orders: orders.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount })),
    wishlist: wishProducts.map((wp) => {
      const match = wp.match(/^(.+) \(৳(\d+)\)$/);
      return { title: match?.[1] || wp, price: match ? Number(match[2]) : 0 };
    }),
    userContext: {
      typicalBudget: preferences?.typicalBudgetMax || 30000,
      goals: goals.map((g) => ({ title: g.title, targetBudget: g.targetBudget })),
    },
  };

  try {
    const result = await completeWithContext(
      [{ role: "user", content: prompt }],
      aiContext,
      {
        system: `${systemContext}\nYou are an intelligent e-commerce personal assistant for Bangladesh.`,
        maxTokens: 500,
      }
    );

    sendSuccess(res, { answer: result.content, isFallback: result.isFallback });
  } catch {
    // Deterministic Rule-Based Fallback
    let fallbackAnswer = "I am here to assist with your shopping activity! ";
    const lower = prompt.toLowerCase();
    if (lower.includes("wishlist")) {
      fallbackAnswer = wishProducts.length
        ? `You have ${wishProducts.length} items in your wishlist: ${wishProducts.slice(0, 3).join(", ")}.`
        : "Your wishlist is currently empty.";
    } else if (lower.includes("order") || lower.includes("ordered") || lower.includes("bought")) {
      fallbackAnswer = orders.length
        ? `You have placed ${orders.length} recent orders: ${orderSummary}.`
        : "You have not placed any orders yet.";
    } else if (lower.includes("budget") || lower.includes("spent")) {
      fallbackAnswer = `Your configured shopping budget target is ৳${(preferences?.typicalBudgetMax || 30000).toLocaleString()}.`;
    } else {
      fallbackAnswer = "I can answer questions about your wishlist, order delivery statuses, recent spending, and shopping goals!";
    }

    sendSuccess(res, { answer: fallbackAnswer, isFallback: true });
  }
});

// ============================================================
// COD ORDER RISK (kept - no equivalent exists in risk/order-risk module,
// which assesses an EXISTING order by :orderId, not a pre-purchase customer risk profile)
// ============================================================
