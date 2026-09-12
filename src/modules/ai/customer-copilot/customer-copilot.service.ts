import { Order } from "../../orders/order.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { Product } from "../../products/product.model";
import { UserPreferences } from "../../customer/customer-features.model";
import { ShoppingGoal, ShoppingJourney } from "../../customer/customer-intelligence.model";
import { completeWithContext, completeWithTools, GeminiToolDefinition, AiContext } from "../providers/gemini.provider";
import { AiConversation } from "../advisor/conversation.model";
import { CUSTOMER_COPILOT_SYSTEM_PROMPT } from "./customer-copilot.prompts";
import { logAiIncident } from "../incident/incident.service";
import { logger } from "../../../utils/logger";

export interface CustomerCopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface CustomerCopilotResponse {
  answer: string;
  suggestedActions: CustomerCopilotAction[];
  isFallback: boolean;
  conversationId?: string;
}

export type CustomerIntent =
  | "GENERAL"
  | "ORDERS"
  | "WISHLIST"
  | "BUDGET_GOALS"
  | "RECOMMENDATION";

const CUSTOMER_SPENDING_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
] as const;

export interface CustomerSpendingSummary {
  totalSpent: number;
  qualifyingOrderCount: number;
  hasQualifyingOrders: boolean;
}

const CUSTOMER_AGENT_TOOLS: GeminiToolDefinition[] = [
  {
    name: "search_products",
    description: "Search the approved, in-stock ShopNest catalog using the customer's generic search terms and optional price/category filters.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Natural-language catalog search text" },
        minPrice: { type: "NUMBER", description: "Optional minimum price" },
        maxPrice: { type: "NUMBER", description: "Optional maximum price" },
        category: { type: "STRING", description: "Optional catalog category" },
        limit: { type: "NUMBER", description: "Maximum number of candidates, capped by the backend" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Get one real approved ShopNest product by its catalog ID.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" } }, required: ["productId"] },
  },
  {
    name: "get_my_orders",
    description: "Get the authenticated customer's recent orders. Ownership is supplied by the backend.",
    parameters: { type: "OBJECT", properties: { limit: { type: "NUMBER" } } },
  },
  {
    name: "get_my_wishlist",
    description: "Get the authenticated customer's wishlist products. Ownership is supplied by the backend.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_my_preferences",
    description: "Get the authenticated customer's saved preferences and shopping goals. Ownership is supplied by the backend.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

function formatSpecifications(specs: any): Record<string, string> {
  if (!specs) return {};
  if (specs instanceof Map) {
    return Object.fromEntries(specs.entries());
  }
  if (typeof specs === "object" && !Array.isArray(specs)) {
    return { ...specs };
  }
  return {};
}

function productForTool(product: any) {
  return {
    id: product._id.toString(),
    title: product.title,
    description: product.description,
    price: product.price,
    discountPrice: product.discountPrice,
    category: product.category,
    stock: product.stock,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    tags: product.tags,
    specifications: formatSpecifications(product.specifications),
    freeDelivery: product.freeDelivery,
    aiPick: product.aiPick,
  };
}

async function executeCustomerTool(name: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  if (name === "search_products") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const filter: Record<string, unknown> = { isDeleted: false, status: "approved", stock: { $gt: 0 } };
    const price: Record<string, number> = {};
    if (typeof args.minPrice === "number") price.$gte = args.minPrice;
    if (typeof args.maxPrice === "number") price.$lte = args.maxPrice;
    if (Object.keys(price).length) filter.price = price;
    if (typeof args.category === "string" && args.category.trim()) filter.category = { $regex: args.category.trim(), $options: "i" };
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 12);

    let products: any[];
    if (query) {
      filter.$or = [{ $text: { $search: query } }, { category: { $regex: query, $options: "i" } }];
      products = await Product.find(filter, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" }, ratingAvg: -1, sold: -1, aiPick: -1 })
        .limit(limit)
        .lean();
    } else {
      products = await Product.find(filter)
        .sort({ ratingAvg: -1, sold: -1, aiPick: -1 })
        .limit(limit)
        .lean();
    }
    return { products: products.map(productForTool) };
  }

  if (name === "get_product") {
    const product = await Product.findOne({ _id: args.productId, isDeleted: false, status: "approved" }).lean();
    return { product: product ? productForTool(product) : null };
  }

  if (name === "get_my_orders") {
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
    const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    return { orders: orders.map((order) => ({ id: order._id.toString(), status: order.status, totalAmount: order.totalAmount, createdAt: order.createdAt, items: order.items.map((item) => ({ title: item.title, quantity: item.quantity, price: item.price })) })) };
  }

  if (name === "get_my_wishlist") {
    const wishlist = await Wishlist.findOne({ userId }).lean();
    const ids = wishlist?.items?.map((item) => item.productId) ?? [];
    const products = ids.length ? await Product.find({ _id: { $in: ids }, isDeleted: false, status: "approved" }).lean() : [];
    return { products: products.map(productForTool) };
  }

  if (name === "get_my_preferences") {
    const [preferences, goals] = await Promise.all([
      UserPreferences.findOne({ userId }).lean(),
      ShoppingGoal.find({ userId }).sort({ createdAt: -1 }).limit(3).lean(),
    ]);
    return { preferences, goals };
  }

  throw new Error(`Unknown customer tool: ${name}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function understandCatalogRequest(query: string): Promise<{ searchText: string; minPrice: number | null; maxPrice: number | null; category: string | null; preferences: string[] }> {
  return { searchText: query, minPrice: null, maxPrice: null, category: null, preferences: [] as string[] };
}

async function handleCustomerAgentQuery(query: string, userId: string, conversationId?: string): Promise<CustomerCopilotResponse> {
  let conversation = conversationId
    ? await AiConversation.findOne({ _id: conversationId, userId })
    : null;
  if (!conversation) conversation = new AiConversation({ userId, messages: [] });

  const history = conversation.messages.slice(-10).map((message) => ({ role: message.role, content: message.content } as const));
  const messages = [...history, { role: "user" as const, content: query }];
  const agentSystem = `${CUSTOMER_COPILOT_SYSTEM_PROMPT}

You are a tool-using shopping agent. Decide when you need ShopNest catalog or customer data and call the available tools. Tool results are the only source of product and account facts.
- Use tools instead of guessing or asking the user to provide data that ShopNest can retrieve.
- Recommend only products returned by tools.
- Ask a clarification question when the tool results do not satisfy the request.
- You may call more than one tool, but stop after the tool results are sufficient.
- Never provide internal IDs to the customer unless needed for an order reference.`;

  let result: { content: string; isFallback: boolean };
  try {
    result = await completeWithTools(
      messages,
      CUSTOMER_AGENT_TOOLS,
      (name, args) => executeCustomerTool(name, args, userId),
      { system: agentSystem, maxTokens: 500, temperature: 0.3 }
    );
  } catch (error) {
    const intent = detectCustomerIntent(query);
    logger.warn("Customer copilot agent failed; falling back to deterministic response", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId,
      endpoint: "/ai/customer-copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });
    result = {
      content: generateCustomerFallback(query, intent, [], 0, []),
      isFallback: true,
    };
  }

  conversation.messages.push({ role: "user", content: query, at: new Date() });
  conversation.messages.push({ role: "assistant", content: result.content, at: new Date() });
  await conversation.save();

  return {
    answer: result.content,
    suggestedActions: generateSuggestedActions(query, 0, 0, 0),
    isFallback: result.isFallback,
    conversationId: conversation._id.toString(),
  };
}

export function calculateCustomerSpending(orders: Array<{ status: string; totalAmount: number }>): CustomerSpendingSummary {
  const qualifyingOrders = orders.filter((order) => CUSTOMER_SPENDING_STATUSES.includes(order.status as typeof CUSTOMER_SPENDING_STATUSES[number]));
  const totalSpent = qualifyingOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  return {
    totalSpent,
    qualifyingOrderCount: qualifyingOrders.length,
    hasQualifyingOrders: qualifyingOrders.length > 0,
  };
}

export function detectCustomerIntent(query: string): CustomerIntent {
  const q = query.toLowerCase().trim();
  if (
    q === "hi" ||
    q === "hello" ||
    q === "hey" ||
    q.startsWith("hi ") ||
    q.startsWith("hello ") ||
    q.startsWith("hey ") ||
    q.includes("who are you") ||
    q.includes("what can you do") ||
    q === "help"
  ) {
    return "GENERAL";
  }

  if (
    q.includes("order") ||
    q.includes("track") ||
    q.includes("delivery") ||
    q.includes("package") ||
    q.includes("shipment") ||
    q.includes("bought") ||
    q.includes("purchase") ||
    q.includes("status")
  ) {
    return "ORDERS";
  }

  if (
    q.includes("wishlist") ||
    q.includes("saved") ||
    q.includes("favorite") ||
    q.includes("favourite")
  ) {
    return "WISHLIST";
  }

  if (
    q.includes("budget") ||
    q.includes("goal") ||
    q.includes("spend") ||
    q.includes("target")
  ) {
    return "BUDGET_GOALS";
  }

  return "RECOMMENDATION";
}

export async function handleCustomerCopilotQuery(
  query: string,
  userId: string,
  conversationId?: string
): Promise<CustomerCopilotResponse> {
  return handleCustomerAgentQuery(query, userId, conversationId);

  // Legacy pre-agent context path retained below only until its tests and callers are fully migrated.
  const startTime = Date.now();
  const intent = detectCustomerIntent(query);

  let orders: any[] = [];
  let totalOrderCount = 0;
  let wishlistProducts: Array<{ title: string; price: number }> = [];
  let preferences: any = null;
  let goals: any[] = [];
  let journey: any = null;
  let candidateProducts: any[] = [];
  let spending: CustomerSpendingSummary = {
    totalSpent: 0,
    qualifyingOrderCount: 0,
    hasQualifyingOrders: false,
  };

  // 1. Fetch relevant customer account context based on detected intent
  if (intent === "GENERAL") {
    // Minimal context for greetings: do not fetch heavy datasets
  } else if (intent === "ORDERS") {
    const [fetchedOrders, count] = await Promise.all([
      Order.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
      Order.countDocuments({ userId }),
    ]);
    orders = fetchedOrders;
    totalOrderCount = count;
  } else if (intent === "WISHLIST") {
    const wishlistDoc = await Wishlist.findOne({ userId }).lean();
    const wishlistItems = wishlistDoc?.items ?? [];
    if (wishlistItems.length > 0) {
      const productIds = wishlistItems.slice(0, 10).map((i: any) => i.productId);
      const products = await Product.find({ _id: { $in: productIds }, isDeleted: false })
        .select("title price")
        .lean();
      wishlistProducts = products.map((p) => ({ title: p.title, price: p.price }));
    }
  } else if (intent === "BUDGET_GOALS") {
    const [prefs, userGoals, customerOrders] = await Promise.all([
      UserPreferences.findOne({ userId }).lean(),
      ShoppingGoal.find({ userId }).sort({ createdAt: -1 }).limit(3).lean(),
      Order.find({ userId }).select("status totalAmount").lean(),
    ]);
    preferences = prefs;
    goals = userGoals;
    spending = calculateCustomerSpending(customerOrders);
  } else {
    // Broad / recommendation query: fetch full context
    const [catalogSearch, fetchedOrders, count, wishlistDoc, prefs, userGoals, customerJourney] = await Promise.all([
      understandCatalogRequest(query),
      Order.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
      Order.countDocuments({ userId }),
      Wishlist.findOne({ userId }).lean(),
      UserPreferences.findOne({ userId }).lean(),
      ShoppingGoal.find({ userId }).sort({ createdAt: -1 }).limit(3).lean(),
      ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 }).lean(),
    ]);
    orders = fetchedOrders;
    totalOrderCount = count;
    preferences = prefs;
    goals = userGoals;
    journey = customerJourney;
    spending = calculateCustomerSpending(fetchedOrders);

    const wishlistItems = wishlistDoc?.items ?? [];
    if (wishlistItems.length > 0) {
      const productIds = wishlistItems.slice(0, 10).map((i: any) => i.productId);
      const products = await Product.find({ _id: { $in: productIds }, isDeleted: false })
        .select("title price category")
        .lean();
      wishlistProducts = products.map((p) => ({ title: p.title, price: p.price }));
    }

    const recommendationFilters: Record<string, unknown>[] = [];
    const previousProductIds = orders.flatMap((order) => (order.items ?? []).map((item: any) => item.productId)).filter(Boolean);
    const wishlistProductIds = (wishlistDoc?.items ?? []).map((item: any) => item.productId).filter(Boolean);
    if (journey?.recommendedProducts?.length) {
      recommendationFilters.push({ _id: { $in: journey.recommendedProducts.slice(0, 10) } });
    }
    if (previousProductIds.length || wishlistProductIds.length) {
      recommendationFilters.push({ _id: { $in: [...new Set([...previousProductIds, ...wishlistProductIds])] } });
    }
    const customerCatalogSignals = [
      ...(preferences?.preferredCategories ?? []),
      ...(journey?.category ? [journey.category] : []),
      ...goals.map((goal) => goal.category).filter(Boolean),
    ];
    const searchText = [catalogSearch.searchText, ...catalogSearch.preferences, ...customerCatalogSignals]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (searchText) recommendationFilters.push({ $text: { $search: searchText } });
    const requestedCategory = catalogSearch.category ?? undefined;
    if (requestedCategory) recommendationFilters.push({ category: { $regex: escapeRegex(requestedCategory!), $options: "i" } });

    const priceFilter: Record<string, number> = {};
    const requestedMinPrice = catalogSearch.minPrice ?? undefined;
    const requestedMaxPrice = catalogSearch.maxPrice ?? undefined;
    if (typeof requestedMinPrice === "number") priceFilter.$gte = requestedMinPrice!;
    if (typeof requestedMaxPrice === "number") priceFilter.$lte = requestedMaxPrice!;

    if (recommendationFilters.length > 0) {
      candidateProducts = await Product.find({
        isDeleted: false,
        status: "approved",
        stock: { $gt: 0 },
        ...(Object.keys(priceFilter).length > 0 ? { price: priceFilter } : {}),
        $or: recommendationFilters,
      })
        .select("title price discountPrice category stock ratingAvg ratingCount tags freeDelivery aiPick")
        .sort({ aiPick: -1, ratingAvg: -1, sold: -1 })
        .limit(8)
        .lean();
    }
  }

  // 2. Format customer context for prompt & provider
  const ordersSummary = orders.map((o) => ({
    id: o._id.toString(),
    status: o.status,
    totalAmount: o.totalAmount,
    date: new Date(o.createdAt).toLocaleDateString(),
    items: (o.items || []).map((it: any) => `${it.title} (x${it.quantity || 1})`).join(", "),
  }));

  const aiContext: AiContext = {
    products: candidateProducts.map((product) => ({
      id: product._id.toString(),
      title: product.title,
      price: product.price,
      category: product.category,
      ratingAvg: product.ratingAvg,
      stock: product.stock,
    })),
    orders: orders.map((o) => ({
      id: o._id.toString(),
      status: o.status,
      totalAmount: o.totalAmount,
    })),
    wishlist: wishlistProducts,
    userContext: {
      userId,
      intent,
      totalOrderCount,
      recentOrders: ordersSummary,
      wishlistCount: wishlistProducts.length,
      wishlistItems: wishlistProducts,
      preferredCategories: preferences?.preferredCategories ?? [],
      budgetRange: preferences
        ? `৳${preferences.typicalBudgetMin} - ৳${preferences.typicalBudgetMax}`
        : "Not specified",
      preferredDelivery: preferences?.preferredDelivery ?? "any",
      shoppingGoals: goals.map((g) => ({
        title: g.title,
        category: g.category,
        targetBudget: g.targetBudget,
        currentAmount: g.currentAmount,
        remainingAmount: g.remainingAmount,
        progressPercentage: g.progressPercentage,
        targetDate: g.targetDate ? new Date(g.targetDate).toISOString() : null,
        status: g.status,
      })),
      spending: {
        totalSpent: spending.totalSpent,
        qualifyingOrderCount: spending.qualifyingOrderCount,
        hasQualifyingOrders: spending.hasQualifyingOrders,
        qualifyingStatuses: CUSTOMER_SPENDING_STATUSES,
      },
      shoppingJourney: journey
        ? {
          category: journey.category,
          currentStage: journey.currentStage,
          recommendedNextCategory: journey.recommendedNextCategory,
          recommendedProducts: journey.recommendedProducts,
          journeyProgress: journey.journeyProgress,
          recentEvents: (journey.events ?? []).slice(-10).map((event: any) => ({
            eventType: event.eventType,
            productId: event.productId,
            productTitle: event.productTitle,
            category: event.category,
            price: event.price,
          })),
        }
        : null,
      recommendationCandidates: candidateProducts.map((product) => ({
        id: product._id.toString(),
        title: product.title,
        price: product.price,
        discountPrice: product.discountPrice,
        category: product.category,
        stock: product.stock,
        ratingAvg: product.ratingAvg,
        ratingCount: product.ratingCount,
        tags: product.tags,
        freeDelivery: product.freeDelivery,
        aiPick: product.aiPick,
      })),
      recommendationAvailability: candidateProducts.length > 0 ? "candidates_available" : "insufficient_data",
    },
  };

  let contextPrompt = "";
  if (intent === "GENERAL") {
    contextPrompt = "Context: The customer is saying hello or asking for assistance. Keep your response friendly, welcoming, and concise (1-2 sentences).";
  } else if (intent === "ORDERS") {
    contextPrompt = `
Customer Order Information:
- Total Orders Placed: ${totalOrderCount}
- Recent Orders:
${orders.length === 0
        ? "  No orders found on account."
        : ordersSummary
          .map(
            (o) =>
              `  • Order #${o.id.slice(-6)}: Status: ${o.status}, Amount: ৳${o.totalAmount}, Items: ${o.items}, Date: ${o.date}`
          )
          .join("\n")
      }
`;
  } else if (intent === "WISHLIST") {
    contextPrompt = `
Customer Wishlist Information:
- Saved Items (${wishlistProducts.length}):
${wishlistProducts.length === 0
        ? "  Wishlist is currently empty."
        : wishlistProducts.map((w) => `  • ${w.title} (৳${w.price})`).join("\n")
      }
`;
  } else {
    contextPrompt = `
Customer Account Context:
- Orders Count: ${totalOrderCount}
- Wishlist Items (${wishlistProducts.length}): ${wishlistProducts.map((w) => w.title).join(", ") || "Empty"}
- Preferred Categories: ${preferences?.preferredCategories?.join(", ") || "None specified"}
- Typical Budget: ${preferences
        ? `৳${preferences.typicalBudgetMin} - ৳${preferences.typicalBudgetMax}`
        : "Not set"
      }
- Active Goals: ${goals.map((g) => `${g.title} (৳${g.targetBudget})`).join(", ") || "None"}
`;
  }

  if (intent === "RECOMMENDATION") {
    const structuredCandidates = candidateProducts.map((product) => ({
      id: product._id.toString(),
      title: product.title,
      price: product.price,
      ...(product.discountPrice !== undefined ? { discountPrice: product.discountPrice } : {}),
      category: product.category,
      stock: product.stock,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
      tags: product.tags,
      freeDelivery: product.freeDelivery,
      aiPick: product.aiPick,
    }));
    contextPrompt = `
TRUSTED CATALOG PRODUCTS
The following are real products retrieved from the ShopNest catalog. Use these structured product records as the complete recommendation set.
${JSON.stringify(structuredCandidates, null, 2)}

CUSTOMER REQUEST
${query}

RECOMMENDATION INSTRUCTIONS
- Recommend only products present in the catalog records above.
- Respect explicit preferences in the customer request, including brand, product type, and budget when those facts are available in the records.
- Compare supplied products or ask a useful clarification question when the data is insufficient.
- Do not invent products, prices, brands, specifications, or availability.
- Do not treat category names, tags, keywords, or other metadata as separate products.
- If no supplied product satisfies an explicit preference, say so honestly instead of silently substituting another product.
`;
  }

  if (intent === "BUDGET_GOALS") {
    contextPrompt = `
Customer Spending Information:
- Total Spent on Qualifying Orders: ৳${spending.totalSpent}
- Qualifying Orders: ${spending.qualifyingOrderCount}
- No qualifying orders: ${spending.hasQualifyingOrders ? "No" : "Yes"}
${spending.hasQualifyingOrders ? "" : "There are no qualifying orders to calculate spending from; report zero or no data truthfully."}
`;
  }

  let answer: string;
  let isFallback = false;

  try {
    const result = await completeWithContext(
      [
        {
          role: "user",
          content: `${contextPrompt}\n\nCustomer Question: "${query}"`,
        },
      ],
      aiContext,
      { system: CUSTOMER_COPILOT_SYSTEM_PROMPT, maxTokens: 400, temperature: 0.3 }
    );
    answer = result.content;
    isFallback = result.isFallback;
  } catch (err) {
    logger.warn("Customer copilot AI provider failed; falling back to deterministic response", { err });
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId,
      endpoint: "/ai/customer-copilot",
      input: query,
      error: String(err),
    });

    answer = generateCustomerFallback(query, intent, orders, totalOrderCount, wishlistProducts, spending, candidateProducts);
    isFallback = true;
  }

  // 3. Generate suggested actions
  const suggestedActions = generateSuggestedActions(query, totalOrderCount, wishlistProducts.length, goals.length);

  logger.info("Customer Copilot query processed", {
    userId,
    queryLength: query.length,
    intent,
    latencyMs: Date.now() - startTime,
    isFallback,
  });

  return {
    answer,
    suggestedActions,
    isFallback,
  };
}

export function generateCustomerFallback(
  query: string,
  intent: CustomerIntent,
  orders: any[],
  totalOrderCount: number,
  wishlist: Array<{ title: string; price: number }>,
  spending: CustomerSpendingSummary = { totalSpent: 0, qualifyingOrderCount: 0, hasQualifyingOrders: false },
  candidateProducts: Array<{ title: string; price: number; discountPrice?: number }> = []
): string {
  const q = query.toLowerCase();

  if (intent === "GENERAL" || q === "hi" || q === "hello" || q === "hey") {
    return "Hi there! I'm your ShopNest Shopping Assistant. How can I help you today? You can ask about your orders, wishlist, or product recommendations.";
  }

  if (intent === "ORDERS" || q.includes("order") || q.includes("track") || q.includes("status")) {
    if (q.includes("how many") || q.includes("count")) {
      return totalOrderCount === 0
        ? "You don't have any orders on your account yet. Browse our catalog to place your first order!"
        : `You have placed a total of ${totalOrderCount} order${totalOrderCount > 1 ? "s" : ""} on ShopNest.`;
    }

    if (orders.length === 0) {
      return "You don't have any recent orders on your account yet. Browse our catalog to place your first order!";
    }

    const latest = orders[0];
    return `Your latest order (#${latest._id.toString().slice(-6)}) is currently ${latest.status.toUpperCase()} with a total of ৳${latest.totalAmount}. You can track all updates directly in your Orders page.`;
  }

  if (intent === "WISHLIST" || q.includes("wishlist") || q.includes("saved") || q.includes("favorite")) {
    if (wishlist.length === 0) {
      return "Your wishlist is currently empty. Click the heart icon on any product to save items for later!";
    }
    const itemsText = wishlist.slice(0, 3).map((w) => `• ${w.title} (৳${w.price})`).join("\n");
    return `You have ${wishlist.length} item${wishlist.length > 1 ? "s" : ""} in your wishlist:\n${itemsText}\nVisit your wishlist to view all saved items.`;
  }

  if (intent === "BUDGET_GOALS" || q.includes("budget") || q.includes("goal") || q.includes("spend")) {
    return spending.hasQualifyingOrders
      ? `You have spent ৳${spending.totalSpent.toLocaleString()} across ${spending.qualifyingOrderCount} qualifying order${spending.qualifyingOrderCount > 1 ? "s" : ""}.`
      : "You have no qualifying orders yet, so your recorded spending is ৳0.";
  }

  if (intent === "RECOMMENDATION") {
    if (candidateProducts.length === 0) {
      return "I need more information about what you are looking for before I can make a grounded product recommendation.";
    }
    return `Based on your available shopping data, consider ${candidateProducts
      .slice(0, 3)
      .map((product) => `${product.title} (৳${product.discountPrice ?? product.price})`)
      .join(", ")}.`;
  }

  return "I'm here to help you navigate your orders, check your wishlist, track deliveries, and find great products on ShopNest. How can I assist you today?";
}

function generateSuggestedActions(
  query: string,
  ordersCount: number,
  wishlistCount: number,
  goalsCount: number
): CustomerCopilotAction[] {
  const actions: CustomerCopilotAction[] = [];
  const q = query.toLowerCase();

  if (q.includes("order") || q.includes("track") || ordersCount > 0) {
    actions.push({
      label: "My Orders",
      action: "navigate",
      targetUrl: "/customer/orders",
      description: "View order history and live delivery tracking",
    });
  }

  if (q.includes("wishlist") || wishlistCount > 0) {
    actions.push({
      label: "View Wishlist",
      action: "navigate",
      targetUrl: "/customer/wishlist",
      description: "Manage saved products and check price changes",
    });
  }

  if (q.includes("goal") || q.includes("budget") || goalsCount > 0) {
    actions.push({
      label: "Shopping Goals",
      action: "navigate",
      targetUrl: "/customer/goals",
      description: "Track and organize your purchase budgets",
    });
  }

  actions.push({
    label: "Browse Products",
    action: "navigate",
    targetUrl: "/products",
    description: "Discover trending deals and top-rated items",
  });

  return actions.slice(0, 4);
}