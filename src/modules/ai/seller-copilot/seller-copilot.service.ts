import { Store } from "../../sellers/store.model";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { completeWithContext, AiContext } from "../providers/gemini.provider";
import { SELLER_COPILOT_SYSTEM_PROMPT } from "./seller-copilot.prompts";
import { logAiIncident } from "../incident/incident.service";
import { logger } from "../../../utils/logger";

export interface SellerCopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface SellerCopilotResponse {
  answer: string;
  suggestedActions: SellerCopilotAction[];
  isFallback: boolean;
}

export type SellerIntent =
  | "GENERAL"
  | "SALES_TODAY"
  | "SALES"
  | "INVENTORY"
  | "HEALTH"
  | "ORDERS"
  | "ANALYTICS"
  | "REPORT";

const SELLER_SALES_STATUSES = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"] as const;

function isSellerSalesStatus(status: string): boolean {
  return (SELLER_SALES_STATUSES as readonly string[]).includes(status);
}

function getSellerDataStart(query: string): Date {
  const now = new Date();
  const start = new Date(now);
  const normalizedQuery = query.toLowerCase();

  if (normalizedQuery.includes("today") || normalizedQuery.includes("24 hours")) {
    return getStartOfTodayBST();
  }
  if (normalizedQuery.includes("this week")) {
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (normalizedQuery.includes("this month")) {
    return new Date(start.getFullYear(), start.getMonth(), 1);
  }

  start.setDate(start.getDate() - 30);
  return start;
}

export function getStartOfTodayBST(): Date {
  const now = new Date();
  const bstOffset = 6 * 60 * 60 * 1000; // Bangladesh is UTC+6
  const bstNow = new Date(now.getTime() + bstOffset);
  const bstStartOfDay = new Date(
    Date.UTC(bstNow.getUTCFullYear(), bstNow.getUTCMonth(), bstNow.getUTCDate())
  );
  return new Date(bstStartOfDay.getTime() - bstOffset);
}

export function detectSellerIntent(query: string): SellerIntent {
  const q = query.toLowerCase().trim();

  if (
    q === "hi" ||
    q === "hello" ||
    q === "hey" ||
    q.startsWith("hi ") ||
    q.startsWith("hello ") ||
    q.startsWith("hey ") ||
    q === "help"
  ) {
    return "GENERAL";
  }

  if (
    q.includes("today") ||
    q.includes("24 hours") ||
    q.includes("last 24")
  ) {
    if (
      q.includes("sell") ||
      q.includes("sale") ||
      q.includes("product") ||
      q.includes("unit") ||
      q.includes("revenue") ||
      q.includes("order") ||
      q.includes("earning") ||
      q.includes("how many")
    ) {
      return "SALES_TODAY";
    }
  }

  if (
    q.includes("report") ||
    q.includes("executive briefing") ||
    q.includes("full overview") ||
    q.includes("sales report")
  ) {
    return "REPORT";
  }

  if (
    q.includes("health") ||
    q.includes("rating") ||
    q.includes("trust score") ||
    q.includes("score")
  ) {
    return "HEALTH";
  }

  if (
    q.includes("stock") ||
    q.includes("inventory") ||
    q.includes("restock")
  ) {
    return "INVENTORY";
  }

  if (
    q.includes("pending") ||
    q.includes("fulfillment") ||
    q.includes("ship")
  ) {
    return "ORDERS";
  }

  if (
    q.includes("analytics") ||
    q.includes("conversion") ||
    q.includes("gmv") ||
    q.includes("traffic") ||
    q.includes("performance")
  ) {
    return "ANALYTICS";
  }

  if (
    q.includes("sell") ||
    q.includes("sales") ||
    q.includes("revenue") ||
    q.includes("earning") ||
    q.includes("sold")
  ) {
    return "SALES";
  }

  return "ANALYTICS";
}

export async function handleSellerCopilotQuery(
  query: string,
  sellerId: string
): Promise<SellerCopilotResponse> {
  const startTime = Date.now();
  const intent = detectSellerIntent(query);

  try {
    // 1. Resolve seller store strictly by authenticated seller ownership (read-only)
    const store = await Store.findOne({ ownerId: sellerId }).lean();

    if (!store) {
      return {
        answer:
          "You do not have an active store registered on ShopNest yet. Please complete your store registration in the Seller Portal to start managing products, monitoring inventory, and tracking sales performance.",
        suggestedActions: [
          {
            label: "Set Up Store",
            action: "navigate",
            targetUrl: "/seller/store/setup",
            description: "Register your storefront and business details",
          },
        ],
        isFallback: true,
      };
    }

    const storeIdStr = store._id.toString();
    const startOfToday = getStartOfTodayBST();
    const dataStart = getSellerDataStart(query);

    // 2. Fetch products and orders with robust null and type safety
    const [products, recentOrders, todayOrders] = await Promise.all([
      Product.find({
        storeId: { $in: [storeIdStr, store._id] },
        isDeleted: false,
        status: "approved",
      }).lean(),
      Order.find({
        "items.storeId": { $in: [storeIdStr, store._id] },
        createdAt: { $gte: dataStart },
      })
        .sort({ createdAt: -1 })
        .lean(),
      Order.find({
        "items.storeId": { $in: [storeIdStr, store._id] },
        createdAt: { $gte: startOfToday },
      }).lean(),
    ]);

    // 3. Compute key inventory, sales, and health metrics
    const outOfStock = products.filter((p) => (p.stock || 0) === 0);
    const lowStock = products.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= 5);
    const pendingOrders = recentOrders.filter((o) => o.status === "pending" || o.status === "processing");
    const deliveredOrders = recentOrders.filter((o) => o.status === "delivered");
    const cancelledOrders = recentOrders.filter((o) => o.status === "cancelled");
    const returnedOrders = recentOrders.filter((o) => o.status === "returned");
    const refundedOrders = recentOrders.filter((o) => o.status === "refunded");

    // Calculate today's sales metrics specifically for this store
    let unitsSoldToday = 0;
    let revenueToday = 0;
    let ordersReceivedToday = 0;
    for (const order of todayOrders) {
      let hasSellerSales = false;
      for (const item of order.items || []) {
        if ((String(item.storeId) === storeIdStr || String(item.storeId) === String(store._id)) && isSellerSalesStatus(order.status)) {
          const price = typeof item.price === "number" ? item.price : 0;
          const qty = typeof item.quantity === "number" ? item.quantity : 1;
          hasSellerSales = true;
          unitsSoldToday += qty;
          revenueToday += price * qty;
        }
      }
      if (hasSellerSales) ordersReceivedToday += 1;
    }

    // Calculate all-time / recent store sales metrics
    let recentStoreRevenue = 0;
    let recentUnitsSold = 0;
    const productSales = new Map<string, { title: string; unitsSold: number; revenue: number; price: number; category: string }>();
    for (const order of recentOrders) {
      for (const item of order.items || []) {
        if ((String(item.storeId) === storeIdStr || String(item.storeId) === String(store._id)) && isSellerSalesStatus(order.status)) {
          const price = typeof item.price === "number" ? item.price : 0;
          const qty = typeof item.quantity === "number" ? item.quantity : 1;
          recentStoreRevenue += price * qty;
          recentUnitsSold += qty;
          const product = products.find((candidate) => candidate._id.toString() === String(item.productId));
          if (product) {
            const current = productSales.get(String(item.productId)) || {
              title: product.title,
              unitsSold: 0,
              revenue: 0,
              price: product.price,
              category: product.category,
            };
            current.unitsSold += qty;
            current.revenue += price * qty;
            productSales.set(String(item.productId), current);
          }
        }
      }
    }

    const topProducts = [...productSales.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5);

    // Compute store health summary
    const storeRating = typeof store.rating === "number" ? store.rating : null;
    const trustScore = typeof store.trustScore === "number" ? store.trustScore : null;
    const healthStatus = storeRating === null || trustScore === null
      ? "Unavailable"
      : storeRating >= 4.5 && trustScore >= 70 && outOfStock.length === 0
        ? "Excellent"
        : storeRating >= 3.8 && trustScore >= 50
          ? "Good"
          : "Fair";

    // 4. Build AI context
    const aiContext: AiContext = {
      products: products.slice(0, 15).map((p) => ({
        id: p._id.toString(),
        title: p.title,
        price: p.price,
        category: p.category,
        ratingAvg: p.ratingAvg,
        stock: p.stock,
      })),
      orders: recentOrders.slice(0, 5).map((o) => ({
        id: o._id.toString(),
        status: o.status,
        totalAmount: o.totalAmount,
      })),
      userContext: {
        storeName: store.storeName,
        storeStatus: store.status,
        intent,
        totalProducts: products.length,
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        lowStockProducts: lowStock.map((p) => ({ title: p.title, stock: p.stock || 0 })),
        topProducts: topProducts.map((p) => ({
          title: p.title,
          unitsSold: p.unitsSold,
          revenue: p.revenue,
          price: p.price,
          category: p.category,
        })),
        unitsSoldToday,
        ordersReceivedToday,
        revenueToday,
        totalOrdersRecent: recentOrders.length,
        pendingOrdersCount: pendingOrders.length,
        deliveredOrdersCount: deliveredOrders.length,
        cancelledOrdersCount: cancelledOrders.length,
        returnedOrdersCount: returnedOrders.length,
        refundedOrdersCount: refundedOrders.length,
        recentStoreRevenue,
        recentUnitsSold,
        salesTimeRange: dataStart.toISOString(),
        storeRating,
        trustScore,
        healthStatus,
      },
    };

    let contextPrompt = "";
    if (intent === "GENERAL") {
      contextPrompt = `Context: The merchant is greeting or asking for general assistance for store "${store.storeName}". Respond with a polite, brief greeting (1-2 sentences) and offer assistance with today's sales, stock levels, or analytics.`;
    } else if (intent === "SALES_TODAY") {
      contextPrompt = `
Today's Store Sales Data for "${store.storeName}" (Bangladesh Time / Today):
- Units Sold Today: ${unitsSoldToday}
- Orders Received Today: ${ordersReceivedToday}
- Estimated Revenue Today: ৳${revenueToday.toLocaleString()}
Instructions: Answer the question directly in 1-2 sentences. Clearly state that the merchant sold ${unitsSoldToday} unit(s) across ${ordersReceivedToday} order(s) today.
`;
    } else if (intent === "INVENTORY") {
      contextPrompt = `
Store Inventory Context for "${store.storeName}":
- Total Active Catalog: ${products.length} products
- Out of Stock (${outOfStock.length} items): ${outOfStock.length === 0 ? "None" : outOfStock.map((p) => p.title).join(", ")}
- Low Stock (${lowStock.length} items, stock <= 5): ${lowStock.length === 0 ? "None" : lowStock.map((p) => `${p.title} (${p.stock} left)`).join(", ")}
Instructions: Answer directly with inventory status in 1-3 sentences.
`;
    } else if (intent === "HEALTH") {
      contextPrompt = `
Store Health Context for "${store.storeName}":
- Overall Status: ${healthStatus}
- Trust Score: ${trustScore}/100
- Store Rating: ${storeRating}/5.0
- Out of Stock Items: ${outOfStock.length}
- Low Stock Items: ${lowStock.length}
- Pending Orders: ${pendingOrders.length}
Instructions: State the health status naturally (e.g. "Your store health is Good with a Trust Score of ${trustScore}/100..."). NEVER output contradictory phrases like "Good (Action Required)".
`;
    } else if (intent === "ANALYTICS") {
      contextPrompt = `
Store Analytics Context for "${store.storeName}":
- Total Products: ${products.length}
- Recent Estimated Revenue: ৳${recentStoreRevenue.toLocaleString()}
- Recent Units Sold: ${recentUnitsSold}
- Recent Orders Sample: ${recentOrders.length}
- Pending Orders: ${pendingOrders.length}
- Top Selling Products: ${topProducts.map((p) => `${p.title} (${p.unitsSold} sold, ৳${p.revenue.toLocaleString()} revenue, ${p.category})`).join(", ") || "Insufficient sales data"}
Instructions: Provide a concise analytical overview.
`;
    } else {
      contextPrompt = `
Store Information for "${store.storeName}":
- Total Products: ${products.length}
- Today's Sales: ${unitsSoldToday} units across ${ordersReceivedToday} orders (৳${revenueToday.toLocaleString()})
- Recent Revenue: ৳${recentStoreRevenue.toLocaleString()} (${recentUnitsSold} valid units sold)
- Inventory Alerts: ${outOfStock.length} out of stock, ${lowStock.length} low stock
- Pending Fulfillment: ${pendingOrders.length} orders
- Order Health: ${cancelledOrders.length} cancelled, ${returnedOrders.length} returned, ${refundedOrders.length} refunded
- Health: ${healthStatus} (Trust: ${trustScore}/100, Rating: ${storeRating})
`;
    }

    let answer: string;
    let isFallback = false;

    try {
      const result = await completeWithContext(
        [
          {
            role: "user",
            content: `${contextPrompt}\n\nMerchant Question: "${query}"`,
          },
        ],
        aiContext,
        { system: SELLER_COPILOT_SYSTEM_PROMPT, maxTokens: 450, temperature: 0.3 }
      );
      answer = result.content;
      isFallback = result.isFallback;
    } catch (err) {
      logger.warn("Seller copilot AI provider failed; falling back to deterministic response", { err });
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId: sellerId,
        endpoint: "/ai/seller-copilot",
        input: query,
        error: err instanceof Error ? err.message : String(err),
      });

      answer = generateSellerFallback({
        query,
        intent,
        storeName: store.storeName,
        totalProducts: products.length,
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        pendingOrdersCount: pendingOrders.length,
        recentRevenue: recentStoreRevenue,
        recentUnitsSold,
        unitsSoldToday,
        ordersReceivedToday,
        revenueToday,
        healthStatus,
        trustScore,
        storeRating,
      });
      isFallback = true;
    }

    const suggestedActions = generateSuggestedActions(
      query,
      lowStock.length + outOfStock.length,
      pendingOrders.length
    );

    logger.info("Seller Copilot query processed", {
      sellerId,
      storeId: storeIdStr,
      intent,
      latencyMs: Date.now() - startTime,
      isFallback,
    });

    return {
      answer,
      suggestedActions,
      isFallback,
    };
  } catch (error) {
    logger.error("Seller copilot internal error; providing safe deterministic fallback", { error });
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: sellerId,
      endpoint: "/ai/seller-copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      answer: `I am currently analyzing your store data for Store Analytics. Your storefront is active and operational. Please review your Seller Dashboard for real-time order and sales metrics.`,
      suggestedActions: [
        {
          label: "Store Analytics",
          action: "navigate",
          targetUrl: "/seller/analytics",
          description: "View store performance metrics",
        },
      ],
      isFallback: true,
    };
  }
}

export interface SellerFallbackData {
  query: string;
  intent: SellerIntent;
  storeName: string;
  totalProducts: number;
  outOfStockCount: number;
  lowStockCount: number;
  pendingOrdersCount: number;
  recentRevenue: number;
  recentUnitsSold: number;
  unitsSoldToday: number;
  ordersReceivedToday: number;
  revenueToday: number;
  healthStatus: string;
  trustScore: number | null;
  storeRating: number | null;
}

export function generateSellerFallback(data: SellerFallbackData): string {
  const {
    intent,
    storeName,
    totalProducts,
    outOfStockCount,
    lowStockCount,
    pendingOrdersCount,
    recentRevenue,
    recentUnitsSold,
    unitsSoldToday,
    ordersReceivedToday,
    revenueToday,
    healthStatus,
    trustScore,
    storeRating,
  } = data;

  if (intent === "GENERAL") {
    return `Welcome to your Seller Copilot for **${storeName}**. I can help you check today's sales, track inventory levels, review pending orders, or analyze store performance. How can I assist you today?`;
  }

  if (intent === "SALES_TODAY") {
    if (unitsSoldToday === 0 && ordersReceivedToday === 0) {
      return `You haven't recorded any product sales yet today for **${storeName}**. Active products are listed and ready for customer orders.`;
    }
    return `Today for **${storeName}**, you sold **${unitsSoldToday} product(s)** (${unitsSoldToday} units across ${ordersReceivedToday} order${ordersReceivedToday > 1 ? "s" : ""}) with an estimated revenue of **৳${revenueToday.toLocaleString()}**.`;
  }

  if (intent === "INVENTORY") {
    if (outOfStockCount > 0 || lowStockCount > 0) {
      return `Attention needed for **${storeName}** inventory: You currently have **${outOfStockCount}** out-of-stock product(s) and **${lowStockCount}** low-stock item(s) (<= 5 units). Total active catalog: ${totalProducts} items. Restocking promptly will prevent lost sales.`;
    }
    return `Your inventory levels for **${storeName}** look healthy with ${totalProducts} active product(s) adequately stocked.`;
  }

  if (intent === "HEALTH") {
    const warnings: string[] = [];
    if (outOfStockCount > 0) warnings.push(`${outOfStockCount} product(s) are out of stock`);
    if (lowStockCount > 0) warnings.push(`${lowStockCount} item(s) are running low`);
    if (pendingOrdersCount > 0) warnings.push(`${pendingOrdersCount} order(s) are pending dispatch`);

    const warningText =
      warnings.length > 0
        ? ` However, ${warnings.join(" and ")}.`
        : " All operational metrics are in order.";

    const healthDetails = trustScore === null || storeRating === null
      ? "Trust score and customer rating are unavailable."
      : `Trust Score of **${trustScore}/100** and a customer rating of **${storeRating}/5.0**`;
    return `Your store health is **${healthStatus}**. **${storeName}** has ${healthDetails}.${warningText}`;
  }

  if (intent === "ORDERS") {
    return `You currently have **${pendingOrdersCount}** order(s) waiting for fulfillment. Dispatching orders promptly improves your delivery reliability and customer reviews.`;
  }

  if (intent === "ANALYTICS" || intent === "REPORT") {
    return `Store Analytics for **${storeName}**: You have **${totalProducts}** active products listed. Recent performance shows **${recentUnitsSold}** units sold across recent orders, generating an estimated revenue of **৳${recentRevenue.toLocaleString()}**, with **${pendingOrdersCount}** orders currently pending.`;
  }

  if (intent === "SALES") {
    return `Your estimated store revenue is **৳${recentRevenue.toLocaleString()}** across recent orders with **${recentUnitsSold}** units sold. Today's sales: **${unitsSoldToday}** unit(s) (৳${revenueToday.toLocaleString()}).`;
  }

  return `Welcome to your Seller Copilot for **${storeName}**. You have ${totalProducts} products listed, ${pendingOrdersCount} pending orders, and recent revenue of ৳${recentRevenue.toLocaleString()}. How can I help you optimize your store today?`;
}

function generateSuggestedActions(
  query: string,
  inventoryAlertsCount: number,
  pendingOrdersCount: number
): SellerCopilotAction[] {
  const actions: SellerCopilotAction[] = [];
  const q = query.toLowerCase();

  if (q.includes("inventory") || q.includes("stock") || inventoryAlertsCount > 0) {
    actions.push({
      label: "Manage Inventory",
      action: "navigate",
      targetUrl: "/seller/inventory",
      description: "Review stock levels, replenish low inventory, and edit items",
    });
  }

  if (q.includes("order") || pendingOrdersCount > 0) {
    actions.push({
      label: "Fulfill Orders",
      action: "navigate",
      targetUrl: "/seller/orders",
      description: "Process pending customer orders and generate shipping labels",
    });
  }

  actions.push({
    label: "Store Analytics",
    action: "navigate",
    targetUrl: "/seller/analytics",
    description: "Analyze GMV, conversion rates, and revenue trends",
  });

  actions.push({
    label: "Add New Product",
    action: "navigate",
    targetUrl: "/seller/products/new",
    description: "Expand your catalog with new listings",
  });

  return actions.slice(0, 4);
}

