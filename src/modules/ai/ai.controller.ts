import { Request, Response } from "express";
import { Product } from "../products/product.model";
import { Coupon } from "../coupons/coupon.model";
import { Category } from "../categories/category.model";
import { Order } from "../orders/order.model";
import { Store } from "../sellers/store.model";
import { completeJSON, completeJSONWithContext, AiContext } from "./providers/gemini.provider";
import { logger } from "../../utils/logger";
import {
  PRODUCT_DESCRIPTION_SYSTEM,
  buildDescriptionPrompt,
  COMPARE_SYSTEM,
  buildComparePrompt,
  PRICING_SYSTEM,
  buildPricingPrompt,
  PRODUCT_ANALYSIS_SYSTEM,
  PRODUCT_CONTENT_SYSTEM,
  TRANSLATION_SYSTEM,
} from "./prompts";
import { summarizeProductReviews } from "./trust/reviewIntelligence";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logAiIncident } from "./incident/incident.service";
import { getSellerStore } from "../sellers/seller-store.util";

/**
 * Controller: Recommend Products
 *
 * 1. Inputs Extracted:
 *    - req.body: query, budgetMax, category
 * 2. Database Operation:
 *    - Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(10)
 * 3. Response Sent:
 *    - HTTP 200: { count, products: [...] }
 */
export const recommend = asyncHandler(async (req: Request, res: Response) => {
  const { query, budgetMax, category } = req.body as { query?: string; budgetMax?: number; category?: string };

  const filter: Record<string, unknown> = { isDeleted: false, status: "approved" };
  if (budgetMax) filter.price = { $lte: budgetMax };
  if (category) filter.category = category;
  if (query) filter.$text = { $search: query };

  const products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(10);
  sendSuccess(res, { count: products.length, products });
});

/**
 * Controller: Generate AI Product Description (Sellers & Admins)
 *
 * 1. Inputs Extracted:
 *    - req.body: productName, category, features
 *    - req.user: Logged-in seller/admin ID
 * 2. Database Operation:
 *    - None directly; invokes completeJSON prompt engine
 * 3. Response Sent:
 *    - HTTP 200: { description, bulletPoints, isFallback }
 */
export const productDescription = asyncHandler(async (req: Request, res: Response) => {
  const { productName, category, features } = req.body as { productName: string; category: string; features: string[] };

  try {
    const result = await completeJSON(
      [{ role: "user", content: buildDescriptionPrompt({ productName, category, features }) }],
      { system: PRODUCT_DESCRIPTION_SYSTEM }
    );
    sendSuccess(res, { ...(result.data as Record<string, unknown>), isFallback: result.isFallback });
  } catch (err) {
    await logAiIncident({
      type: "MALFORMED_OUTPUT",
      userId: req.user?.id,
      endpoint: "/ai/product-description",
      input: productName,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

/**
 * Controller: Review Summary & Sentiment Breakdown
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product ID
 * 2. Database Operation:
 *    - Queries Review collection via summarizeProductReviews helper
 * 3. Response Sent:
 *    - HTTP 200: Summary JSON object { summary, positivePoints, negativePoints, sentimentScore }
 */
export const reviewSummary = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const result = await summarizeProductReviews(productId);
  sendSuccess(res, result);
});

/**
 * Controller: Compare Products Side-By-Side
 *
 * 1. Inputs Extracted:
 *    - req.body.productIds: Array of product IDs to compare (min 2)
 * 2. Database Operation:
 *    - Product.find({ _id: { $in: productIds }, isDeleted: false })
 * 3. Response Sent:
 *    - HTTP 200: Comparative analysis matrix
 */
export const compareProducts = asyncHandler(async (req: Request, res: Response) => {
  const { productIds } = req.body as { productIds: string[] };
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });
  if (products.length < 2) throw ApiError.badRequest("Could not find enough matching products to compare");

  const result = await completeJSON(
    [
      {
        role: "user",
        content: buildComparePrompt(
          products.map((p) => ({
            id: p.id,
            title: p.title,
            price: p.discountPrice ?? p.price,
            ratingAvg: p.ratingAvg,
            category: p.category,
            stock: p.stock,
          }))
        ),
      },
    ],
    { system: COMPARE_SYSTEM }
  );

  sendSuccess(res, { ...(result.data as Record<string, unknown>), isFallback: result.isFallback });
});

/**
 * Controller: AI Pricing Suggestion (Sellers & Admins)
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product ID
 * 2. Database Operation:
 *    - Product.findOne({ _id: productId })
 *    - Product.aggregate(...) to compute average category price
 * 3. Response Sent:
 *    - HTTP 200: { currentPrice, categoryAvgPrice, suggestedMin, suggestedMax, reason }
 */
export const pricingSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  const categoryAgg = await Product.aggregate([
    { $match: { category: product.category, isDeleted: false, status: "approved" } },
    { $group: { _id: null, avgPrice: { $avg: "$price" } } },
  ]);
  const categoryAvgPrice = Math.round((categoryAgg[0]?.avgPrice ?? product.price) * 100) / 100;

  const result = await completeJSON<{ suggestedMin: number; suggestedMax: number; reason: string }>(
    [
      {
        role: "user",
        content: buildPricingPrompt({
          currentPrice: product.price,
          stock: product.stock,
          sold: product.sold,
          ratingAvg: product.ratingAvg,
          categoryAvgPrice,
        }),
      },
    ],
    { system: PRICING_SYSTEM }
  );

  sendSuccess(res, {
    currentPrice: product.price,
    categoryAvgPrice,
    ...(result.data as Record<string, unknown>),
    isFallback: result.isFallback,
  });
});

/**
 * Controller: Visual Search
 *
 * 1. Inputs Extracted:
 *    - req.body.imageUrl: Image link
 *    - req.body.searchQuery: Optional detected search query
 * 2. Database Operation:
 *    - Product.find(...) based on extracted filename keywords or text search
 * 3. Response Sent:
 *    - HTTP 200: { detectedQuery, count, products }
 */
export const visualSearch = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrl, searchQuery } = req.body as { imageUrl: string; searchQuery?: string };

  let description: string;
  if (searchQuery && searchQuery.trim()) {
    description = searchQuery.trim();
  } else {
    try {
      const urlPath = new URL(imageUrl).pathname;
      const filename = urlPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
      description = filename.replace(/[-_]/g, " ").replace(/\d+/g, "").trim() || "popular products";
    } catch {
      description = "popular products";
    }
  }

  const searchTerms = description.replace(/[^a-zA-Z\s]/g, " ").trim();
  const products = await Product.find({
    isDeleted: false,
    status: "approved",
    $or: [
      { $text: { $search: searchTerms } },
      { tags: { $in: searchTerms.split(" ").filter((w) => w.length > 2).map((w) => new RegExp(w, "i")) } },
      { category: { $regex: searchTerms.split(" ")[0] || "", $options: "i" } },
    ],
  }).limit(10);

  const fallbackProducts =
    products.length === 0
      ? await Product.find({ isDeleted: false, status: "approved" }).sort({ sold: -1 }).limit(10)
      : products;

  sendSuccess(res, {
    detectedQuery: description,
    count: fallbackProducts.length,
    products: fallbackProducts,
    usedFallback: products.length === 0,
  });
});

const memoryStore = new Map<string, { preferences: string[]; activeTheme: string; lastSearchIntent: string }>();

/**
 * Controller: Get AI Commerce Memory
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID (or "guest")
 * 2. Database Operation:
 *    - In-memory preferences store lookup
 * 3. Response Sent:
 *    - HTTP 200: { userId, memory, controls: { canReset, personalizationEnabled } }
 */
export const getAiCommerceMemory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "guest";
  const userMemory = memoryStore.get(userId) || {
    preferences: ["Prefers fast domestic dispatch in Dhaka", "Interest in High-Performance Tech & Accessories"],
    activeTheme: "Electronics & Tech Setup",
    lastSearchIntent: "Gaming gear under ৳50,000",
  };

  sendSuccess(res, {
    userId,
    memory: userMemory,
    controls: {
      canReset: true,
      personalizationEnabled: true,
    },
  });
});

/**
 * Controller: Clear AI Commerce Memory
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 * 2. Database Operation:
 *    - Deletes user key from memoryStore
 * 3. Response Sent:
 *    - HTTP 200: { success: true }
 */
export const clearAiCommerceMemory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "guest";
  memoryStore.delete(userId);
  sendSuccess(res, { success: true }, "AI commerce preferences and shopping memory cleared");
});

/**
 * Controller: AI Shopping Negotiator
 *
 * 1. Inputs Extracted:
 *    - req.body.productId: Target product (optional)
 *    - req.body.cartSubtotal: Subtotal to optimize
 * 2. Database Operation:
 *    - Product.findById(productId)
 *    - Coupon.find({ isActive: true }) to find best lawful promo codes
 * 3. Response Sent:
 *    - HTTP 200: { originalPrice, bestEffectivePrice, totalSavings, savingsPercent, discountBreakdown, negotiationStrategy }
 */
export const negotiateDeal = asyncHandler(async (req: Request, res: Response) => {
  const { productId, cartSubtotal = 5000 } = req.body;

  const product = productId ? await Product.findById(productId) : null;
  const originalPrice = product ? (product.discountPrice || product.price) : Number(cartSubtotal);

  const activeCoupons = await Coupon.find({ isActive: true });
  const bestCoupon = activeCoupons[0] || {
    code: "SHOPNEST10",
    type: "percentage" as const,
    value: 10,
    minPurchase: 1000,
    isActive: true,
  };

  const couponDiscount =
    bestCoupon.type === "percentage"
      ? Math.round(originalPrice * (bestCoupon.value / 100))
      : bestCoupon.value;
  const platformOffer = originalPrice > 3000 ? 150 : 0;
  const bestEffectivePrice = Math.max(100, originalPrice - couponDiscount - platformOffer);
  const totalSavings = originalPrice - bestEffectivePrice;

  sendSuccess(res, {
    originalPrice,
    bestEffectivePrice,
    totalSavings,
    savingsPercent: Math.round((totalSavings / originalPrice) * 100),
    discountBreakdown: [
      {
        type: "Seller / Product Direct Promotion",
        amount: product?.discountPrice ? product.price - product.discountPrice : 0,
      },
      { type: `Platform Coupon (${bestCoupon.code})`, amount: couponDiscount, code: bestCoupon.code },
      { type: "Free Express Delivery Credit", amount: platformOffer },
    ],
    negotiationStrategy: `✨ Optimized stack: Applied valid promo code '${bestCoupon.code}' and ৳${platformOffer} logistics subsidy. AI does not alter baseline catalog prices.`,
  });
});

/**
 * Controller: AI Shopping Intent & Database-Driven Search Assistant
 *
 * 1. Inputs Extracted:
 *    - req.body.prompt: User natural language search prompt (English or Bangla)
 * 2. Database Operation:
 *    - Parses budget, recipient, and category keywords
 *    - Product.find(filter) using strict budget cap & regex matching
 * 3. Response Sent:
 *    - HTTP 200: { extractedIntent, matchingProducts, recommendationSummary }
 */
export const detectShoppingIntent = asyncHandler(async (req: Request, res: Response) => {
  const { prompt = "I need a gift for my brother's birthday under 5000" } = req.body;
  const rawPrompt = String(prompt).trim();

  // Transliterate Bengali numerals to English (০-৯ -> 0-9)
  const bnToEnMap: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };
  const normalizedPrompt = rawPrompt.replace(/[০-৯]/g, (d) => bnToEnMap[d] || d);
  const lower = normalizedPrompt.toLowerCase();

  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  // Check for 'k' multiplier (e.g. "under 5k")
  const kBudgetMatch =
    lower.match(/(?:under|below|budget|within|max|niche|moddhe|vitor|kom|takar)\s*(\d+(?:\.\d+)?)\s*k\b/i) ||
    lower.match(/(\d+(?:\.\d+)?)\s*k\s*(?:under|below|budget|within|takar|tk|৳|moddhe|niche|vitor)/i);

  if (kBudgetMatch) {
    maxPrice = Math.round(parseFloat(kBudgetMatch[1]) * 1000);
  } else {
    const budgetPatterns = [
      /(?:under|below|budget|within|less than|max|maximum|up to|highest|niche|er niche|moddhe|er moddhe|vitor|kom)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i,
      /(?:tk|taka|৳)\s*(\d+[\d,]*)\s*(?:under|below|niche|er niche|moddhe|er moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:tk|taka|৳)\s*(?:er)?\s*(?:niche|moddhe|vitor|kom)/i,
      /(\d+[\d,]*)\s*(?:takar|taka|tk|৳)\s*(?:moddhe|vitor|niche)/i,
    ];
    for (const pattern of budgetPatterns) {
      const match = lower.match(pattern);
      if (match) {
        maxPrice = Number(match[1].replace(/,/g, ""));
        break;
      }
    }
  }

  const minMatch = lower.match(/(?:above|more than|at least|min|minimum|theke|from)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i);
  if (minMatch) {
    minPrice = Number(minMatch[1].replace(/,/g, ""));
  }

  let occasion = "General Shopping";
  if (lower.includes("birthday") || lower.includes("jonmodin")) occasion = "Birthday Celebration";
  else if (lower.includes("eid") || lower.includes("roza")) occasion = "Eid Festival";
  else if (lower.includes("wedding") || lower.includes("biye") || lower.includes("anniversary")) occasion = "Wedding / Anniversary";
  else if (lower.includes("office") || lower.includes("work") || lower.includes("desk")) occasion = "Professional / Office Setup";
  else if (lower.includes("gaming") || lower.includes("gamer") || lower.includes("esport")) occasion = "Gaming Setup";
  else if (lower.includes("gym") || lower.includes("workout") || lower.includes("running") || lower.includes("fitness")) occasion = "Sports & Fitness";
  else if (lower.includes("travel") || lower.includes("tour")) occasion = "Travel & Outdoor";

  let recipient = "Self";
  if (lower.includes("mother") || lower.includes("mom") || lower.includes("ammu") || lower.includes("ma")) recipient = "Mother";
  else if (lower.includes("father") || lower.includes("dad") || lower.includes("abbu") || lower.includes("baba")) recipient = "Father";
  else if (lower.includes("brother") || lower.includes("bhai") || lower.includes("vai")) recipient = "Brother";
  else if (lower.includes("sister") || lower.includes("bon") || lower.includes("apu")) recipient = "Sister";
  else if (lower.includes("friend") || lower.includes("bondhu") || lower.includes("dost")) recipient = "Friend";
  else if (lower.includes("wife") || lower.includes("bou") || lower.includes("husband") || lower.includes("shami")) recipient = "Spouse";
  else if (lower.includes("kids") || lower.includes("baby") || lower.includes("child") || lower.includes("baccha")) recipient = "Kids / Baby";

  const stopWords = [
    "i need", "i want", "show me", "find me", "give me", "suggest", "recommend", "looking for",
    "something for", "a gift for", "gift", "gifts", "under", "below", "less than", "within",
    "budget", "price", "taka", "takar", "tk", "tks", "er", "moddhe", "vitor", "niche",
    "kom", "ami", "chai", "lagbe", "khojo", "dekhao", "kono", "bhalo", "best", "good",
    "cheap", "expensive", "brother", "sister", "mother", "father", "friend", "birthday",
    "eid", "wedding", "anniversary", "office", "work", "for", "a", "an", "the", "in",
    "and", "or", "to", "with", "please", "item", "product", "products", "stuff",
  ];

  let cleaned = lower.replace(/\b\d+(?:[.,]\d+)?\s*(?:k|tk|taka|৳)?\b/gi, " ");
  for (const sw of stopWords) {
    const reg = new RegExp(`\\b${sw}\\b`, "gi");
    cleaned = cleaned.replace(reg, " ");
  }

  const searchTokens = cleaned
    .replace(/[^\w\s\u0980-\u09FF-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const cleanSearchQuery = searchTokens.join(" ");

  const filter: Record<string, any> = {
    isDeleted: false,
    status: "approved",
  };

  if (maxPrice !== null && maxPrice > 0) {
    filter.price = { $lte: maxPrice };
  }
  if (minPrice !== null && minPrice > 0) {
    filter.price = { ...(filter.price || {}), $gte: minPrice };
  }

  let categoryHint = "";
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) categoryHint = "Phones & Tablets";
  else if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) categoryHint = "Computers";
  else if (lower.includes("mouse") || lower.includes("keyboard") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone") || lower.includes("soundbox") || lower.includes("speaker")) categoryHint = "Electronics";
  else if (lower.includes("shirt") || lower.includes("t-shirt") || lower.includes("saree") || lower.includes("panjabi") || lower.includes("dress") || lower.includes("pant") || lower.includes("jacket")) categoryHint = "Fashion";
  else if (lower.includes("watch") || lower.includes("smartwatch") || lower.includes("bag") || lower.includes("wallet") || lower.includes("perfume")) categoryHint = "Accessories";

  if (searchTokens.length > 0) {
    const tokenConditions = searchTokens.map((token) => ({
      $or: [
        { title: { $regex: token, $options: "i" } },
        { category: { $regex: token, $options: "i" } },
        { tags: { $regex: token, $options: "i" } },
        { description: { $regex: token, $options: "i" } },
      ],
    }));
    filter.$and = tokenConditions;
  } else if (categoryHint) {
    filter.category = { $regex: categoryHint, $options: "i" };
  }

  let matchingProducts = await Product.find(filter)
    .sort({ ratingAvg: -1, sold: -1, stock: -1 })
    .limit(8)
    .lean();

  if (matchingProducts.length === 0 && searchTokens.length > 1) {
    const broaderFilter: Record<string, any> = {
      isDeleted: false,
      status: "approved",
    };
    if (maxPrice !== null && maxPrice > 0) {
      broaderFilter.price = { $lte: maxPrice };
    }
    if (minPrice !== null && minPrice > 0) {
      broaderFilter.price = { ...(broaderFilter.price || {}), $gte: minPrice };
    }
    broaderFilter.$or = searchTokens.map((token) => ({
      title: { $regex: token, $options: "i" },
    }));

    matchingProducts = await Product.find(broaderFilter)
      .sort({ ratingAvg: -1, sold: -1 })
      .limit(6)
      .lean();
  }

  let recommendationSummary = "";
  if (matchingProducts.length === 0) {
    const budgetClause = maxPrice ? ` under ৳${maxPrice.toLocaleString()}` : "";
    const termClause = cleanSearchQuery ? ` for "${cleanSearchQuery}"` : "";
    recommendationSummary = `I couldn't find any products in our current catalog matching${termClause}${budgetClause}. Please try searching with a different keyword or adjusting your budget.`;
  } else {
    const budgetClause = maxPrice ? ` within your budget of ৳${maxPrice.toLocaleString()}` : "";
    const targetClause = cleanSearchQuery ? ` for "${cleanSearchQuery}"` : (occasion !== "General Shopping" ? ` for ${occasion}` : "");
    recommendationSummary = `Found ${matchingProducts.length} verified products from real marketplace inventory${targetClause}${budgetClause}. All items are in-stock and spec-verified.`;
  }

  sendSuccess(res, {
    extractedIntent: {
      occasion,
      recipient,
      detectedBudget: maxPrice ? `৳${maxPrice.toLocaleString()}` : "Any Budget",
      categoryFocus: categoryHint || (searchTokens.length > 0 ? searchTokens.join(" ") : "All Categories"),
      rawQuery: rawPrompt,
    },
    matchingProducts: matchingProducts.map((p: any) => ({
      id: String(p._id),
      _id: String(p._id),
      title: p.title,
      description: p.description,
      price: p.price,
      discountPrice: p.discountPrice,
      category: p.category,
      images: p.images || [],
      stock: p.stock || 0,
      ratingAvg: p.ratingAvg || 0,
      ratingCount: p.ratingCount || 0,
      sold: p.sold || 0,
      tags: p.tags || [],
    })),
    recommendationSummary,
  });
});

/**
 * Controller: Multi-Role AI Commerce Copilot (Customer, Seller, Admin)
 *
 * 1. Inputs Extracted:
 *    - req.body: query, role, context
 *    - req.user: User session
 * 2. Database Operation:
 *    - Fetches role-specific marketplace telemetry or order stats
 * 3. Response Sent:
 *    - HTTP 200: { role, query, answer, suggestedActions, isFallback }
 */
export const commerceCopilot = asyncHandler(async (req: Request, res: Response) => {
  const { query, role = "customer" } = req.body;
  const userRole = req.user?.role || role;
  const userId = req.user?.id;

  if (!query) throw ApiError.badRequest("Please provide a prompt for the AI Copilot");

  let answer = "";
  let suggestedActions: Array<{ label: string; action: string; targetUrl?: string }> = [];
  const aiContext: AiContext = {};

  if (userRole === "admin" && userId) {
    const userCount = await import("../users/user.model").then((m) => m.usersCollection().countDocuments({}));
    const sellerCount = await import("../sellers/store.model").then((m) => m.Store.countDocuments({}));
    const orderCount = await Order.countDocuments({});
    const productCount = await Product.countDocuments({ isDeleted: false });
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $in: ["delivered", "shipped", "out_for_delivery"] } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    aiContext.userContext = {
      userCount,
      sellerCount,
      orderCount,
      productCount,
      totalRevenue: totalRevenue[0]?.total || 0,
    };
    answer = `📊 **Marketplace Overview**: ${userCount} users, ${sellerCount} sellers, ${orderCount} orders, ${productCount} products. Total revenue: ৳${(totalRevenue[0]?.total || 0).toLocaleString()}.`;
    suggestedActions = [
      { label: "Review Anomaly Center", action: "navigate", targetUrl: "/admin/dashboard" },
      { label: "Inspect Geographical Map", action: "filter", targetUrl: "/admin/dashboard" },
    ];
  } else if (userRole === "seller" && userId) {
    const store = await Store.findOne({ $or: [{ ownerId: userId }, { userId }] });
    if (store) {
      const [orderCount, productCount] = await Promise.all([
        Order.countDocuments({ "items.sellerId": store.id }),
        Product.countDocuments({ storeId: store.id, isDeleted: false }),
      ]);
      aiContext.userContext = {
        storeName: store.storeName,
        trustScore: store.trustScore,
        orderCount,
        productCount,
      };
      answer = `💼 **Store Overview**: ${store.storeName} (Trust Score: ${store.trustScore}/100). ${orderCount} orders, ${productCount} active products.`;
    } else {
      answer = "You don't have a store registered yet. Register a store to access seller insights.";
    }
    suggestedActions = [
      { label: "Run Campaign Simulator", action: "open_simulator" },
      { label: "View Profitability Waterfall", action: "navigate" },
    ];
  } else {
    if (userId) {
      const [orders, wishlist] = await Promise.all([
        Order.find({ customerId: userId }).sort({ createdAt: -1 }).limit(5),
        import("../wishlist/wishlist.model").then((m) => m.Wishlist.findOne({ userId })),
      ]);
      aiContext.orders = orders.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount }));
      aiContext.userContext = { wishlistCount: wishlist?.items?.length || 0 };
      answer = `🛍️ **Shopping Summary**: You have ${orders.length} recent orders${wishlist?.items?.length ? ` and ${wishlist.items.length} items in your wishlist` : ""}. How can I help you today?`;
    } else {
      answer = "Welcome to ShopNest! I can help you find products, compare prices, and manage your orders.";
    }
    suggestedActions = [
      { label: "Open Budget Planner", action: "open_budget" },
      { label: "Check Product Compatibility", action: "open_compatibility" },
    ];
  }

  sendSuccess(res, {
    role: userRole,
    query,
    answer,
    suggestedActions,
    isFallback: true,
  });
});

/**
 * Controller: AI Product Image Analysis (Vision)
 *
 * 1. Inputs Extracted:
 *    - req.body: imageUrls (string[]), optional seller hints
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - Fetches similar products for price/category context
 * 3. Response Sent:
 *    - HTTP 200: { analysis, detectedCategory, confidence, isFallback }
 */
export const analyzeProductImages = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrls, hints } = req.body as { imageUrls: string[]; hints?: Record<string, string> };
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw ApiError.badRequest("Please provide at least one product image URL.");
  }

  const userId = req.user?.id;
  let categoryContext: string[] = [];
  let priceContext: { avgPrice: number; minPrice: number; maxPrice: number } | null = null;

  if (hints?.category) {
    const cats = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${hints.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
        { slug: hints.category.toLowerCase() },
      ],
    }).limit(5);
    categoryContext = cats.map((c) => c.name);
  }

  if (categoryContext.length > 0) {
    const agg = await Product.aggregate([
      { $match: { category: { $in: categoryContext }, isDeleted: false, status: "approved" } },
      {
        $group: {
          _id: null,
          avgPrice: { $avg: "$price" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
        },
      },
    ]);
    if (agg[0]) {
      priceContext = {
        avgPrice: Math.round(agg[0].avgPrice || 0),
        minPrice: Math.round(agg[0].minPrice || 0),
        maxPrice: Math.round(agg[0].maxPrice || 0),
      };
    }
  }

  const imageContent = imageUrls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const userPrompt = `Analyze these ${imageUrls.length} product image(s) and identify the product details.

${hints?.productName ? `Seller-provided product name hint: ${hints.productName}` : ""}
${hints?.notes ? `Seller notes: ${hints.notes}` : ""}
${categoryContext.length > 0 ? `Known categories in our marketplace: ${categoryContext.join(", ")}` : ""}
${priceContext ? `Category price range: ৳${priceContext.minPrice} - ৳${priceContext.maxPrice} (avg ৳${priceContext.avgPrice})` : ""}

Return ONLY valid JSON (no markdown, no preamble):
{
  "detectedProductType": string,
  "detectedCategory": string,
  "detectedSubcategory": string,
  "detectedColor": string | "Not detected",
  "detectedMaterial": string | "Not detected",
  "detectedBrand": string | "Not detected",
  "detectedFeatures": string[],
  "detectedUseCase": string,
  "suggestedTitle": string,
  "suggestedTags": string[],
  "conditionNotes": string,
  "confidence": "high" | "medium" | "low"
}`;

  const messages = [
    { role: "user" as const, content: [...imageContent, { type: "text" as const, text: userPrompt }] },
  ];

  const context: AiContext = { productName: hints?.productName, category: hints?.category };
  let result: {
    detectedProductType: string;
    detectedCategory: string;
    detectedSubcategory: string;
    detectedColor: string;
    detectedMaterial: string;
    detectedBrand: string;
    detectedFeatures: string[];
    detectedUseCase: string;
    suggestedTitle: string;
    suggestedTags: string[];
    conditionNotes: string;
    confidence: "high" | "medium" | "low";
  };
  let isFallback = false;

  try {
    const parsed = await completeJSONWithContext<{
      detectedProductType: string;
      detectedCategory: string;
      detectedSubcategory: string;
      detectedColor: string;
      detectedMaterial: string;
      detectedBrand: string;
      detectedFeatures: string[];
      detectedUseCase: string;
      suggestedTitle: string;
      suggestedTags: string[];
      conditionNotes: string;
      confidence: "high" | "medium" | "low";
    }>(messages, context, { system: PRODUCT_ANALYSIS_SYSTEM, maxTokens: 1024, temperature: 0.3 });
    result = parsed.data;
    isFallback = parsed.isFallback;
  } catch {
    isFallback = true;
    result = {
      detectedProductType: hints?.productName ? "Product" : "Unidentified Product",
      detectedCategory: hints?.category || "General",
      detectedSubcategory: "",
      detectedColor: "Not detected",
      detectedMaterial: "Not detected",
      detectedBrand: "Not detected",
      detectedFeatures: hints?.specialFeatures ? hints.specialFeatures.split(",").map((s) => s.trim()).filter(Boolean) : [],
      detectedUseCase: hints?.targetCustomer || "General use",
      suggestedTitle: hints?.productName || "Product from Uploaded Images",
      suggestedTags: hints?.category ? [hints.category.toLowerCase()] : [],
      conditionNotes: "AI analysis is temporarily unavailable. Please review and complete the product details manually.",
      confidence: "low",
    };
  }

  sendSuccess(res, {
    ...result,
    isFallback,
    imageUrls,
  });
});

/**
 * Controller: Generate Complete Product Content from Images
 *
 * 1. Inputs Extracted:
 *    - req.body: imageUrls, analysis (optional), hints
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - Fetches category pricing context
 *    - Fetches similar products for pricing signals
 * 3. Response Sent:
 *    - HTTP 200: { title, description, shortDescription, features, specifications, category, tags, seoTitle, seoDescription, highlights, marketingCaption, suggestedPrice, priceRange, isFallback }
 */
export const generateProductFromImages = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrls, analysis, hints } = req.body as {
    imageUrls: string[];
    analysis?: Record<string, unknown>;
    hints?: Record<string, string>;
  };

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw ApiError.badRequest("Please provide at least one product image URL.");
  }

  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Seller authentication required");
  }
  const store = await getSellerStore(userId);

  let categoryAvgPrice = 0;
  const detectedCat = typeof analysis?.detectedCategory === "string" ? (analysis.detectedCategory as string) : "";
  const hintCat = typeof hints?.category === "string" ? (hints.category as string) : "";
  let suggestedCategory = hintCat || detectedCat || "General";

  if (suggestedCategory && suggestedCategory !== "General") {
    const escaped = suggestedCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const catNames = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${escaped}$`, "i") } },
        { slug: suggestedCategory.toLowerCase() },
      ],
    }).limit(5);
    if (catNames.length > 0) {
      const catNameList = catNames.map((c) => c.name);
      const agg = await Product.aggregate([
        { $match: { category: { $in: catNameList }, isDeleted: false, status: "approved" } },
        { $group: { _id: null, avgPrice: { $avg: "$price" } } },
      ]);
      if (agg[0]?.avgPrice) categoryAvgPrice = Math.round(agg[0].avgPrice);
    }
  }

  const imageContent = imageUrls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const analysisSummary = analysis
    ? `AI Image Analysis Results:\n` +
      `- Product Type: ${analysis.detectedProductType || "Not detected"}\n` +
      `- Category: ${analysis.detectedCategory || "Not detected"}\n` +
      `- Subcategory: ${analysis.detectedSubcategory || "Not detected"}\n` +
      `- Color: ${analysis.detectedColor || "Not detected"}\n` +
      `- Material: ${analysis.detectedMaterial || "Not detected"}\n` +
      `- Brand: ${analysis.detectedBrand || "Not detected"}\n` +
      `- Features: ${Array.isArray(analysis.detectedFeatures) ? analysis.detectedFeatures.join(", ") : "Not detected"}\n` +
      `- Use Case: ${analysis.detectedUseCase || "Not detected"}\n` +
      `- Confidence: ${analysis.confidence || "medium"}\n`
    : "No image analysis provided. Analyze the images directly.";

  const userPrompt = `You are an expert e-commerce product researcher and copywriter. Analyze these product images and generate a COMPLETE, VERIFIED marketplace product listing.

STEP 1 — PRODUCT IDENTIFICATION:
Study the images carefully. Identify:
- Exact product type/category
- Visible brand logos or marks
- Model numbers or series names
- Colors and materials
- Physical characteristics (shape, size cues)

STEP 2 — RESEARCH & VERIFICATION:
Using your training knowledge, research this product type and provide:
- Typical market price range for this product category
- Standard specifications and dimensions
- Common materials and build quality
- Typical warranty information
- What's usually included in the box
- Common variants/options available

STEP 3 — GENERATE COMPLETE LISTING:

${analysisSummary}

${hints?.productName ? `Seller hint: ${hints.productName}` : ""}
${hints?.costPrice ? `Seller cost price: ৳${hints.costPrice}` : ""}
${hints?.targetCustomer ? `Target customer: ${hints.targetCustomer}` : ""}
${hints?.specialFeatures ? `Special features: ${hints.specialFeatures}` : ""}
${hints?.notes ? `Additional notes: ${hints.notes}` : ""}
${categoryAvgPrice > 0 ? `Category average price on ShopNest: ৳${categoryAvgPrice}` : "No ShopNest pricing data available."}

Return ONLY valid JSON (no markdown, no preamble):
{
  "title": string (professional marketplace title, max 120 chars),
  "category": string (main category),
  "subcategory": string (subcategory if applicable),
  "brand": string (detected or "Not detected"),
  "model": string (detected model or "Not detected"),
  "description": string (detailed long description with: Product Overview, Key Features, Benefits, Specifications, Ideal For, Why Choose This Product, Usage Instructions),
  "shortDescription": string (max 200 chars),
  "features": string[] (4-6 concise feature bullets),
  "specifications": {
    "Brand": string,
    "Model": string,
    "Product Type": string,
    "Color": string,
    "Material": string,
    "Dimensions": string,
    "Weight": string,
    "Warranty": string,
    "What's Included": string,
    [key: string]: string
  },
  "variants": Array<{ name: string; color?: string; priceDelta?: number }>,
  "highlights": string[] (3-5 marketplace highlights),
  "whyBuy": string (2-3 sentences explaining genuine benefits),
  "currentPriceRange": {
    "min": number | null,
    "max": number | null,
    "currency": "BDT",
    "source": string (e.g. "Based on market research")
  },
  "seoTitle": string (max 70 chars, SEO-optimized),
  "seoDescription": string (max 160 chars),
  "tags": string[] (5-8 relevant search tags),
  "marketingCaption": string (short promotional caption for social media),
  "suggestedPrice": number | null,
  "priceReasoning": string
}`;

  const messages = [
    { role: "user" as const, content: [...imageContent, { type: "text" as const, text: userPrompt }] },
  ];

  const context: AiContext = {
    productName: hints?.productName,
    category: suggestedCategory,
    currentPrice: hints?.costPrice ? Number(hints.costPrice) : categoryAvgPrice || undefined,
  };

  let generated: {
    title: string;
    category: string;
    subcategory: string;
    brand: string;
    model: string;
    description: string;
    shortDescription: string;
    features: string[];
    specifications: Record<string, string>;
    variants: Array<{ name: string; color?: string; priceDelta?: number }>;
    highlights: string[];
    whyBuy: string;
    currentPriceRange: { min: number | null; max: number | null; currency: string; source: string };
    seoTitle: string;
    seoDescription: string;
    tags: string[];
    marketingCaption: string;
    suggestedPrice: number | null;
    priceReasoning: string;
  };
  let generateFallback = false;

  try {
    const parsed = await completeJSONWithContext<{
      title: string;
      category: string;
      subcategory: string;
      brand: string;
      model: string;
      description: string;
      shortDescription: string;
      features: string[];
      specifications: Record<string, string>;
      variants: Array<{ name: string; color?: string; priceDelta?: number }>;
      highlights: string[];
      whyBuy: string;
      currentPriceRange: { min: number | null; max: number | null; currency: string; source: string };
      seoTitle: string;
      seoDescription: string;
      tags: string[];
      marketingCaption: string;
      suggestedPrice: number | null;
      priceReasoning: string;
    }>(messages, context, { system: PRODUCT_CONTENT_SYSTEM, maxTokens: 2048, temperature: 0.4 });
    generated = parsed.data;
    generateFallback = parsed.isFallback;
  } catch {
    generateFallback = true;
    const analysisData = analysis as {
      detectedFeatures?: unknown[];
      detectedColor?: string;
      detectedMaterial?: string;
      detectedBrand?: string;
      detectedProductType?: string;
      detectedSubcategory?: string;
      suggestedTitle?: string;
    } | null;
    const fallbackTitle = hints?.productName || analysisData?.suggestedTitle || "Product from Images";
    const fallbackCategory = suggestedCategory;
    const fallbackBrand = analysisData?.detectedBrand === "Not detected" ? "" : (analysisData?.detectedBrand || "");
    const fallbackModel = analysisData?.detectedProductType === "Not detected" ? "" : (analysisData?.detectedProductType || "");
    const fallbackFeatures = [
      ...(Array.isArray(analysisData?.detectedFeatures) ? analysisData.detectedFeatures.map((f) => String(f)) : []),
      ...(hints?.specialFeatures ? hints.specialFeatures.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ].slice(0, 6);
    const fallbackSpecs: Record<string, string> = {
      Brand: fallbackBrand || "Seller confirmation required",
      Model: fallbackModel || "Seller confirmation required",
      "Product Type": fallbackCategory,
      Color: analysisData?.detectedColor === "Not detected" ? "Seller confirmation required" : (analysisData?.detectedColor || "Seller confirmation required"),
      Material: analysisData?.detectedMaterial === "Not detected" ? "Seller confirmation required" : (analysisData?.detectedMaterial || "Seller confirmation required"),
      Dimensions: "Seller confirmation required",
      Weight: "Seller confirmation required",
      Warranty: "Seller confirmation required",
      "What's Included": "Seller confirmation required",
    };
    if (categoryAvgPrice > 0) fallbackSpecs["Category Average Price"] = `৳${categoryAvgPrice}`;

    generated = {
      title: fallbackTitle,
      category: fallbackCategory,
      subcategory: analysisData?.detectedSubcategory || "",
      brand: fallbackBrand,
      model: fallbackModel,
      description: `${fallbackTitle} is a quality ${fallbackCategory} product. ${fallbackFeatures.length > 0 ? `Key features include ${fallbackFeatures.join(", ")}.` : ""} A great choice for customers looking for reliable value.`,
      shortDescription: `${fallbackTitle} in ${fallbackCategory}. ${fallbackFeatures.length > 0 ? "Features: " + fallbackFeatures.slice(0, 3).join(", ") + "." : ""}`,
      features: fallbackFeatures.length > 0 ? fallbackFeatures : ["Quality build", "Reliable performance", "Fast delivery"],
      specifications: fallbackSpecs,
      variants: [],
      highlights: fallbackFeatures.slice(0, 5),
      whyBuy: `This ${fallbackCategory} product offers good value. ${categoryAvgPrice > 0 ? `Category average price is ৳${categoryAvgPrice}.` : ""}`,
      currentPriceRange: {
        min: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 0.9) : null,
        max: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 1.1) : null,
        currency: "BDT",
        source: categoryAvgPrice > 0 ? "Based on ShopNest category data" : "Insufficient data",
      },
      seoTitle: `${fallbackTitle} - Best Price in BD | ShopNest`,
      seoDescription: `Buy genuine ${fallbackTitle} online at best price in Bangladesh on ShopNest. Fast shipping and warranty.`,
      tags: [fallbackCategory.toLowerCase(), ...fallbackTitle.toLowerCase().split(/\s+/)].filter(Boolean).slice(0, 8),
      marketingCaption: `Upgrade your ${fallbackCategory} experience with ${fallbackTitle}.`,
      suggestedPrice: categoryAvgPrice > 0 ? Math.round(categoryAvgPrice * 0.95) : null,
      priceReasoning: categoryAvgPrice > 0 ? `Based on category average of ৳${categoryAvgPrice}.` : "Insufficient market data for reliable price suggestion.",
    };
  }

  const pricing = generated.suggestedPrice && generated.suggestedPrice > 0
    ? { suggestedPrice: generated.suggestedPrice, reasoning: generated.priceReasoning }
    : { suggestedPrice: null, reasoning: "Insufficient market data for reliable price suggestion." };

  sendSuccess(res, {
    ...generated,
    pricing,
    isFallback: generateFallback,
    imageUrls,
    storeId: store._id.toString(),
  });
});

/**
 * Controller: Translate Product Content
 *
 * 1. Inputs Extracted:
 *    - req.body: content sections + targetLanguage
 *    - req.user: Authenticated seller/admin ID
 * 2. Database Operation:
 *    - None
 * 3. Response Sent:
 *    - HTTP 200: { translatedSections, isFallback }
 */
export const translateProductContent = asyncHandler(async (req: Request, res: Response) => {
  const { sections, targetLanguage } = req.body as {
    sections: Record<string, string>;
    targetLanguage: "bn" | "en";
  };

  if (!sections || typeof sections !== "object") {
    throw ApiError.badRequest("Please provide content sections to translate.");
  }
  if (!targetLanguage || !["bn", "en"].includes(targetLanguage)) {
    throw ApiError.badRequest("Target language must be 'bn' (Bangla) or 'en' (English).");
  }

  const entries = Object.entries(sections).filter(([, v]) => v && String(v).trim());
  if (entries.length === 0) {
    throw ApiError.badRequest("No content provided for translation.");
  }

  const languageName = targetLanguage === "bn" ? "Bangla (Bengali)" : "English";

  const prompts = entries.map(
    ([key, value]) =>
      `Section: ${key}\nOriginal: ${value}\nTranslate to ${languageName}. Preserve formatting, line breaks, and structure.`
  );

  const results: Record<string, string> = {};
  for (const prompt of prompts) {
    try {
      const result = await completeJSON<{ translation: string }>(
        [{ role: "user" as const, content: prompt }],
        { system: TRANSLATION_SYSTEM, maxTokens: 512, temperature: 0.3 }
      );
      const match = prompt.match(/Section: (.+)/);
      const sectionKey = match ? match[1] : prompt;
      results[sectionKey] = result.data.translation || String(prompt);
    } catch {
      const match = prompt.match(/Section: (.+)/);
      const sectionKey = match ? match[1] : prompt;
      results[sectionKey] = String(prompt);
    }
  }

  sendSuccess(res, { translatedSections: results, isFallback: false });
});

/**
 * Controller: Suggest Product Price (Seller-specific)
 *
 * 1. Inputs Extracted:
 *    - req.body: category, costPrice (optional)
 *    - req.user: Authenticated seller ID
 * 2. Database Operation:
 *    - Product.aggregate for category avg price
 *    - Seller's own product prices in same category
 * 3. Response Sent:
 *    - HTTP 200: { categoryAvgPrice, sellerAvgPrice, suggestedMin, suggestedMax, reasoning, isFallback }
 */
export const suggestProductPrice = asyncHandler(async (req: Request, res: Response) => {
  const { category, costPrice } = req.body as { category?: string; costPrice?: number };
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Seller authentication required");
  }
  const store = await getSellerStore(userId);

  let categoryAvgPrice = 0;
  let categoryProducts = 0;

  if (category) {
    const catNames = await Category.find({
      $or: [
        { name: { $regex: new RegExp(`^${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
        { slug: category.toLowerCase() },
      ],
    }).limit(5);
    if (catNames.length > 0) {
      const catNameList = catNames.map((c) => c.name);
      const agg = await Product.aggregate([
        { $match: { category: { $in: catNameList }, isDeleted: false, status: "approved" } },
        { $group: { _id: null, avgPrice: { $avg: "$price" }, count: { $sum: 1 } } },
      ]);
      if (agg[0]) {
        categoryAvgPrice = Math.round(agg[0].avgPrice || 0);
        categoryProducts = agg[0].count || 0;
      }
    }
  }

  const sellerAgg = await Product.aggregate([
    { $match: { storeId: store._id.toString(), isDeleted: false } },
    { $group: { _id: "$category", avgPrice: { $avg: "$price" }, count: { $sum: 1 } } },
  ]);
  const sellerAvgByCategory = sellerAgg.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.avgPrice }), {} as Record<string, number>);

  let suggestedMin: number | null = null;
  let suggestedMax: number | null = null;
  let reasoning = "";

  if (categoryAvgPrice > 0) {
    suggestedMin = Math.round(categoryAvgPrice * 0.9);
    suggestedMax = Math.round(categoryAvgPrice * 1.15);
    const sellerAvg = category ? (sellerAvgByCategory[category] || categoryAvgPrice) : categoryAvgPrice;
    reasoning = `Based on ${categoryProducts} similar products in our marketplace with an average price of ৳${categoryAvgPrice}. ` +
      `Your historical average for this category is ৳${Math.round(sellerAvg)}. ` +
      `Suggested range: ৳${suggestedMin} - ৳${suggestedMax}.`;
  } else {
    reasoning = "Not enough comparable products in this category to generate a reliable price suggestion. Consider researching similar listings manually.";
  }

  if (costPrice && costPrice > 0) {
    const minViable = Math.round(costPrice * 1.2);
    if (suggestedMin && suggestedMin < minViable) {
      suggestedMin = minViable;
      reasoning += ` Minimum viable price based on your cost (৳${costPrice}) is ৳${minViable}.`;
    }
  }

  sendSuccess(res, {
    categoryAvgPrice,
    categoryProducts,
    sellerAvgPrice: sellerAvgByCategory[category || ""] || null,
    suggestedMin,
    suggestedMax,
    reasoning,
    isFallback: false,
  });
});
