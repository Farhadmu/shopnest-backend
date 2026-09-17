import { Request, Response } from "express";
import { AiConversation, sanitizeAiConversationMessages } from "./advisor/conversation.model";
import { completeWithContext, AiContext } from "./providers/claude.provider";
import { COMMERCE_COMPANION_SYSTEM, buildCompanionUserPrompt } from "./commerce-companion.prompts";
import {
  searchProducts,
  getCustomerOverview,
  getCustomerOrders,
  getActiveOrders,
  getWishlist,
  getCart,
  getDeliveryStatus,
  getReturnEligibility,
  searchPlatformKnowledge,
  getPlatformRoutes,
} from "./commerce-companion.tools";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logAiIncident } from "./incident/incident.service";
import { CommerceCompanionResponse, DetectedIntent, CommerceCompanionMessage } from "./commerce-companion.types";

function extractBudget(text: string): { max?: number; min?: number } {
  const lower = text.toLowerCase();
  let max: number | undefined;
  let min: number | undefined;

  const kMatch = lower.match(/(?:under|below|budget|within|max|moddhe|vitor|kom|takar)\s*(\d+(?:\.\d+)?)\s*k\b/i) ||
    lower.match(/(\d+(?:\.\d+)?)\s*k\s*(?:under|below|budget|within|takar|tk|৳|moddhe)/i);
  if (kMatch) {
    max = Math.round(parseFloat(kMatch[1]) * 1000);
  } else {
    const budgetPatterns = [
      /(?:under|below|budget|within|less than|max|maximum|up to|niche|er niche|moddhe|er moddhe|vitor|kom)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i,
      /(?:tk|taka|৳)\s*(\d+[\d,]*)\s*(?:under|below|niche|er niche|moddhe|er moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:tk|taka|৳)\s*(?:er)?\s*(?:niche|moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:takar|taka|tk|৳)\s*(?:moddhe|vitor|niche)/i,
    ];
    for (const pattern of budgetPatterns) {
      const match = lower.match(pattern);
      if (match) {
        max = Number(match[1].replace(/,/g, ""));
        break;
      }
    }
  }

  const minMatch = lower.match(/(?:above|more than|at least|min|minimum|theke|from)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i);
  if (minMatch) {
    min = Number(minMatch[1].replace(/,/g, ""));
  }

  return { max, min };
}

function extractCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) return "Phones & Tablets";
  if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) return "Computers & Accessories";
  if (lower.includes("mouse") || lower.includes("keyboard") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone") || lower.includes("soundbox") || lower.includes("speaker")) return "Electronics & Gadgets";
  if (lower.includes("shirt") || lower.includes("t-shirt") || lower.includes("saree") || lower.includes("panjabi") || lower.includes("dress") || lower.includes("pant") || lower.includes("jacket")) return "Fashion & Clothing";
  if (lower.includes("watch") || lower.includes("smartwatch") || lower.includes("bag") || lower.includes("wallet") || lower.includes("perfume")) return "Fashion & Clothing";
  return undefined;
}

function detectIntent(message: string, _userId?: string): DetectedIntent {
  const lower = message.toLowerCase();

  if (/\b(?:order|orders|order status|track order|where is my order|amar order|order koi|order kobe ashbe)\b/i.test(lower)) {
    return { type: "order_inquiry", confidence: 0.9 };
  }
  if (/\b(?:wishlist|saved items|saved products|my wishlist|amar wishlist)\b/i.test(lower)) {
    return { type: "wishlist_inquiry", confidence: 0.9 };
  }
  if (/\b(?:cart|my cart|in my cart|add to cart|checkout)\b/i.test(lower)) {
    return { type: "cart_inquiry", confidence: 0.9 };
  }
  if (/\b(?:return|exchange|return policy|return product|exchange product)\b/i.test(lower)) {
    return { type: "return_inquiry", confidence: 0.9 };
  }
  if (/\b(?:review|rating|feedback|summarize reviews|what people say)\b/i.test(lower)) {
    return { type: "review_inquiry", confidence: 0.8 };
  }
  if (/\b(?:seller|store|about this seller|is this seller|seller info)\b/i.test(lower)) {
    return { type: "seller_inquiry", confidence: 0.8 };
  }
  if (/\b(?:delivery|shipping|tracking|where is my delivery|rider|courier)\b/i.test(lower)) {
    return { type: "delivery_inquiry", confidence: 0.9 };
  }
  if (/\b(?:compare|comparison|versus|vs|which is better|better option)\b/i.test(lower)) {
    return { type: "comparison", confidence: 0.85 };
  }
  if (/\b(?:navigate|go to|take me to|open|where is|show me|find|kothay|kivabe)\b/i.test(lower) && !/\b(?:product|laptop|phone|headphone)\b/i.test(lower)) {
    return { type: "navigation", confidence: 0.7 };
  }
  if (/\b(?:how do i|how to|what is|how does|how can|explain|tell me about|kivabe|kemon)\b/i.test(lower)) {
    return { type: "platform_question", confidence: 0.7 };
  }
  if (/\b(?:find|search|show me|looking for|i need|i want|recommend|suggest|bhai|chai|lagbe|khojo|dekhao)\b/i.test(lower) ||
    /\b(?:laptop|phone|headphone|mouse|keyboard|monitor|watch|bag|shirt|pant)\b/i.test(lower) ||
    /\b(?:under|below|budget|moddhe|niche|takar)\b/i.test(lower)) {
    return { type: "product_search", confidence: 0.8 };
  }
  if (/\b(?:hello|hi|hey|good morning|good evening|bhai|vai|kemon|kemon acho)\b/i.test(lower)) {
    return { type: "general_chat", confidence: 0.6 };
  }

  return { type: "general_chat", confidence: 0.3 };
}

function buildDeterministicResponse(message: string, data: Record<string, any>): string {
  const lower = message.toLowerCase();

  if (data.products && data.products.length > 0) {
    const count = data.products.length;
    const top = data.products[0];
    const rest = count > 1 ? ` I also found ${count - 1} other option${count > 2 ? "s" : ""} worth comparing.` : "";
    const budgetMatch = lower.match(/(\d+[\d,]*)/);
    const budgetText = budgetMatch ? `under ৳${Number(budgetMatch[1].replace(/,/g, "")).toLocaleString()}` : "";
    return `I found ${count} matching product${count > 1 ? "s" : ""}${budgetText ? ` ${budgetText}` : ""}. ${top.title} at ৳${top.price.toLocaleString()}.${rest} I’m showing the verified catalog results here. AI analysis is temporarily limited, so I’m sticking to the real product data available.`;
  }

  if (data.orders && data.orders.length > 0) {
    const latest = data.orders[0];
    return `Your latest order is #${latest.id.slice(-6)} for ৳${latest.totalAmount.toLocaleString()}, currently ${latest.status}. You have ${data.orders.length} total order${data.orders.length > 1 ? "s" : ""} on file.`;
  }

  if (data.wishlistItems && data.wishlistItems.length > 0) {
    return `You have ${data.wishlistItems.length} item${data.wishlistItems.length > 1 ? "s" : ""} saved in your wishlist.`;
  }

  if (data.cartItems && data.cartItems.length > 0) {
    return `Your cart has ${data.cartItems.length} item${data.cartItems.length > 1 ? "s" : ""} totaling ৳${data.cartSummary?.subtotal?.toLocaleString() || "0"}.`;
  }

  if (data.overview) {
    return `Here’s your current snapshot: ${data.overview.totalOrders} orders, ${data.overview.activeOrders} active, ${data.overview.wishlistCount} in wishlist, ${data.overview.cartCount} in cart, and ৳${data.overview.totalSpent.toLocaleString()} spent so far.`;
  }

  return "I couldn’t complete the AI analysis right now, but I can still help you browse available products, track orders, and navigate ShopNest. What would you like to do next?";
}

export const chat = asyncHandler(async (req: Request, res: Response) => {
  const { message, conversationId, currentPage } = req.body as {
    message: string;
    conversationId?: string;
    currentPage?: { route?: string; productId?: string; orderId?: string };
  };

  if (!message || typeof message !== "string") {
    throw ApiError.badRequest("Message is required");
  }

  const userId = req.user?.id;

  let conversation = null;
  if (userId) {
    conversation = conversationId
      ? await AiConversation.findOne({ _id: conversationId, userId })
      : null;
    if (!conversation) {
      conversation = await AiConversation.create({ userId, messages: [] });
    } else {
      conversation.messages = sanitizeAiConversationMessages(conversation.messages || []);
    }
    conversation.messages.push({ role: "user", content: message, at: new Date() });
  }

  const intent = detectIntent(message, userId);
  const toolResults: string[] = [];
  const structuredData: Record<string, any> = {};
  const contextReferences: CommerceCompanionMessage["contextReferences"] = [];
  const actions: any[] = [];
  let thinking = "";

  try {
    const budget = extractBudget(message);
    const category = extractCategory(message);

    if (intent.type === "product_search" || intent.type === "comparison" || intent.type === "budget_search") {
      thinking = "Searching ShopNest catalog...";
      const searchResult = await searchProducts({ query: message, budgetMax: budget.max, budgetMin: budget.min, category });
      if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
        structuredData.products = searchResult.data.slice(0, 8);
        toolResults.push(`Found ${searchResult.data.length} products:`);
        searchResult.data.forEach((p: any, idx: number) => {
          toolResults.push(`${idx + 1}. [${p.id}] ${p.title} | ৳${p.price} | ${p.category} | rating ${p.ratingAvg}/5 | stock ${p.stock}`);
          contextReferences.push({ id: p.id, type: "product", title: p.title });
        });
      } else {
        toolResults.push("No products found matching your criteria.");
      }
    }

    if (intent.type === "order_inquiry" || intent.type === "delivery_inquiry") {
      thinking = "Checking your orders...";
      if (userId) {
        const ordersResult = intent.type === "delivery_inquiry" ? await getActiveOrders(userId) : await getCustomerOrders(userId, 10);
        if (ordersResult.success && ordersResult.data && ordersResult.data.length > 0) {
          structuredData.orders = ordersResult.data;
          toolResults.push(`Found ${ordersResult.data.length} orders:`);
          ordersResult.data.forEach((o: any) => {
            toolResults.push(`- [${o.id}] Order ${o.id.slice(-6)} | ৳${o.totalAmount} | ${o.status} | ${new Date(o.createdAt).toLocaleDateString()}`);
            contextReferences.push({ id: o.id, type: "order", title: `Order ${o.id.slice(-6)}` });
          });
        } else {
          toolResults.push("You have no orders yet.");
        }

        if (intent.type === "delivery_inquiry" && structuredData.orders && structuredData.orders.length > 0) {
          const latestOrder = structuredData.orders[0];
          const deliveryResult = await getDeliveryStatus(userId, latestOrder.id);
          if (deliveryResult.success && deliveryResult.data) {
            structuredData.delivery = deliveryResult.data;
            toolResults.push(`\nDelivery Status for Order ${latestOrder.id.slice(-6)}:`);
            toolResults.push(`Status: ${deliveryResult.data.orderStatus}`);
            if (deliveryResult.data.delivery) {
              toolResults.push(`Tracking: ${deliveryResult.data.delivery.status}`);
              if (deliveryResult.data.delivery.estimatedDelivery) {
                toolResults.push(`Estimated Delivery: ${new Date(deliveryResult.data.delivery.estimatedDelivery).toLocaleDateString()}`);
              }
            }
          }
        }
      } else {
        toolResults.push("Please sign in to view your orders.");
        actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
      }
    }

    if (intent.type === "wishlist_inquiry") {
      thinking = "Checking your wishlist...";
      if (userId) {
        const wishlistResult = await getWishlist(userId);
        if (wishlistResult.success && wishlistResult.data && wishlistResult.data.length > 0) {
          structuredData.wishlistItems = wishlistResult.data;
          toolResults.push(`You have ${wishlistResult.data.length} items in your wishlist:`);
          wishlistResult.data.forEach((item: any, idx: number) => {
            toolResults.push(`${idx + 1}. [${item.productId}] ${item.title} | ৳${item.price} | ${item.category}`);
            contextReferences.push({ id: item.productId, type: "wishlist_item", title: item.title });
          });
        } else {
          toolResults.push("Your wishlist is empty.");
        }
      } else {
        toolResults.push("Please sign in to view your wishlist.");
        actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
      }
    }

    if (intent.type === "cart_inquiry") {
      thinking = "Checking your cart...";
      if (userId) {
        const cartResult = await getCart(userId);
        if (cartResult.success && cartResult.data) {
          structuredData.cartItems = cartResult.data.items;
          structuredData.cartSummary = { subtotal: cartResult.data.subtotal, itemCount: cartResult.data.itemCount };
          if (cartResult.data.items.length > 0) {
            toolResults.push(`You have ${cartResult.data.items.length} items in your cart (Subtotal: ৳${cartResult.data.subtotal.toLocaleString()}):`);
            cartResult.data.items.forEach((item: any, idx: number) => {
              toolResults.push(`${idx + 1}. [${item.productId}] ${item.title} | ৳${item.price} | Qty: ${item.quantity}`);
              contextReferences.push({ id: item.productId, type: "cart_item", title: item.title });
            });
          } else {
            toolResults.push("Your cart is empty.");
          }
        }
      } else {
        toolResults.push("Please sign in to view your cart.");
        actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
      }
    }

    if (intent.type === "return_inquiry") {
      thinking = "Checking return eligibility...";
      if (userId && structuredData.orders && structuredData.orders.length > 0) {
        const latestDelivered = structuredData.orders.find((o: any) => o.status === "delivered");
        if (latestDelivered) {
          const returnResult = await getReturnEligibility(userId, latestDelivered.id);
          if (returnResult.success && returnResult.data) {
            structuredData.returnEligibility = returnResult.data;
            toolResults.push(`Return eligibility for Order ${latestDelivered.id.slice(-6)}:`);
            toolResults.push(`- Delivered: ${returnResult.data.daysSinceDelivery} days ago`);
            toolResults.push(`- Eligible: ${returnResult.data.isEligible ? "Yes" : "No"}`);
            toolResults.push(`- Policy: ${returnResult.data.returnPolicy.windowDays}-day return window`);
          }
        } else {
          toolResults.push("No delivered orders found to check return eligibility.");
        }
      } else if (!userId) {
        toolResults.push("Please sign in to check return eligibility.");
        actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
      }
    }

    if (intent.type === "platform_question") {
      thinking = "Looking up platform information...";
      const knowledgeResult = await searchPlatformKnowledge(message);
      if (knowledgeResult.success && knowledgeResult.data) {
        toolResults.push(knowledgeResult.data);
      }
    }

    if (intent.type === "navigation") {
      thinking = "Finding the right page...";
      const routes = getPlatformRoutes();
      const lower = message.toLowerCase();
      let targetRoute: string | null = null;

      if (lower.includes("wishlist")) targetRoute = routes.wishlist;
      else if (lower.includes("cart")) targetRoute = routes.cart;
      else if (lower.includes("order") && (lower.includes("my") || lower.includes("track"))) targetRoute = routes.orders;
      else if (lower.includes("product")) targetRoute = routes.products;
      else if (lower.includes("compare")) targetRoute = routes.compare;
      else if (lower.includes("store")) targetRoute = routes.stores;
      else if (lower.includes("notification")) targetRoute = routes.notifications;
      else if (lower.includes("ai") || lower.includes("advisor")) targetRoute = routes.aiAdvisor;
      else if (lower.includes("profile")) targetRoute = routes.dashboardUserProfile;
      else if (lower.includes("dashboard")) targetRoute = routes.dashboardUser;

      if (targetRoute) {
        actions.push({ type: "navigate", label: `Go to ${targetRoute.replace("/", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`, targetUrl: targetRoute });
        toolResults.push(`You can find this at: ${targetRoute}`);
      } else {
        toolResults.push("I can help you navigate to: Products, Cart, Wishlist, Orders, Compare, Stores, Notifications, AI Advisor, Profile, or Dashboard.");
      }
    }

    if (intent.type === "general_chat" && userId && !structuredData.products && !structuredData.orders) {
      thinking = "Checking your account...";
      const overviewResult = await getCustomerOverview(userId);
      if (overviewResult.success && overviewResult.data) {
        structuredData.overview = overviewResult.data;
        toolResults.push(`Your Shopping Summary:`);
        toolResults.push(`- Total Orders: ${overviewResult.data.totalOrders}`);
        toolResults.push(`- Active Orders: ${overviewResult.data.activeOrders}`);
        toolResults.push(`- Wishlist: ${overviewResult.data.wishlistCount} items`);
        toolResults.push(`- Cart: ${overviewResult.data.cartCount} items`);
        toolResults.push(`- Total Spent: ৳${overviewResult.data.totalSpent.toLocaleString()}`);
      }
    }
  } catch (error) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: userId,
      endpoint: "/ai/chat",
      input: message,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const history = conversation
    ? conversation.messages.slice(-10).map((m: any) => ({ role: m.role, content: m.content }))
    : [];

  const toolResultsString = toolResults.join("\n") || "No tool results for this query.";
  const userPrompt = buildCompanionUserPrompt(message, toolResultsString, history, currentPage);

  const aiContext: AiContext = {
    products: (structuredData.products || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      category: p.category,
      ratingAvg: p.ratingAvg,
      stock: p.stock,
    })),
    orders: (structuredData.orders || []).map((o: any) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
    })),
    wishlist: (structuredData.wishlistItems || []).map((w: any) => ({
      title: w.title,
      price: w.price,
    })),
    userContext: structuredData.overview,
  };

  let reply: string;
  let isFallback = false;
  let provider: string | undefined;

  try {
    const result = await completeWithContext(
      [...history.slice(0, -1), { role: "user" as const, content: userPrompt }],
      aiContext,
      { system: COMMERCE_COMPANION_SYSTEM, maxTokens: 1500, temperature: 0.3 }
    );
    reply = result.content;
    isFallback = result.isFallback;
    provider = result.provider;
  } catch (err) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: userId,
      endpoint: "/ai/chat",
      input: message,
      error: err instanceof Error ? err.message : String(err),
    });
    reply = buildDeterministicResponse(message, structuredData);
    isFallback = true;
    provider = "deterministic";
  }

  if (conversation) {
    conversation.messages.push({
      role: "assistant",
      content: reply,
      at: new Date(),
      contextReferences: contextReferences as any,
      products: structuredData.products as any,
      orders: structuredData.orders as any,
    } as any);
    await conversation.save();
  }

  const response: CommerceCompanionResponse = {
    reply,
    conversationId: conversation?._id?.toString() || "",
    contextReferences: contextReferences as any,
    products: structuredData.products,
    orders: structuredData.orders,
    wishlistItems: structuredData.wishlistItems,
    cartItems: structuredData.cartItems,
    cartSummary: structuredData.cartSummary,
    reviews: structuredData.reviews,
    seller: structuredData.seller,
    delivery: structuredData.delivery,
    returnEligibility: structuredData.returnEligibility,
    overview: structuredData.overview,
    navigation: actions.filter((a) => a.type === "navigate"),
    actions: actions.filter((a) => a.type !== "navigate"),
    isFallback,
    provider,
    providerStatus: isFallback ? "unavailable" : "available",
    thinking,
  };

  sendSuccess(res, response);
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await AiConversation.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  sendSuccess(res, conversation.toJSON());
});
