import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Product } from "../products/product.model";
import { Store } from "../sellers/store.model";
import { Order } from "../orders/order.model";
import { Coupon } from "../coupons/coupon.model";
import { Review } from "../reviews/review.model";
import { complete, completeJSON, completeWithContext, AiContext } from "../ai/providers/claude.provider";
import { SearchHistory, UserPreferences } from "./customer-features.model";
import { SavedSearch } from "./customer-extras.model";
import { logAiIncident } from "../ai/incident/incident.service";

// ============================================================
// 1. ADVANCED AI SEARCH (Feature 1)
// ============================================================
export const advancedSearch = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous";
  const { q: query, category, minPrice, maxPrice, brand, rating, seller, availability, sort, page = 1, limit = 20 } = req.query as {
    q?: string;
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    brand?: string;
    rating?: string;
    seller?: string;
    availability?: string;
    sort?: string;
    page?: string;
    limit?: string;
  };

  const searchTerm = (query || "").trim();
  if (!searchTerm) {
    throw ApiError.badRequest("Search query is required");
  }

  // Build filter from structured params
  const filter: Record<string, unknown> = { isDeleted: false, status: "approved" };

  // AI intent detection for natural language queries
  let detectedIntent: { category?: string; budgetMax?: number; useCase?: string } = {};
  const hasNaturalLanguage = searchTerm.length > 15 && !searchTerm.match(/^[a-z0-9\s]+$/i);

  if (hasNaturalLanguage || searchTerm.includes("৳") || searchTerm.includes("টাকা") || /[০-৯]/.test(searchTerm)) {
    try {
      const intentResult = await completeJSON(
        [
          {
            role: "user",
            content: `Extract shopping intent from this search query: "${searchTerm}". Return JSON with: category (product type), budgetMax (number in BDT, 0 if none), useCase (gaming/work/study/etc), brand (if mentioned). Bengali numbers: ০=0,১=1,২=2,৩=3,৪=4,৫=5,৬=6,৭=7,৮=8,৯=9. "হাজার"=1000, "লক্ষ"=100000.`,
          },
        ],
        {
          system: 'You are a shopping intent detector for a Bangladeshi e-commerce platform. Parse natural language and Bengali queries. Return ONLY valid JSON: {"category":"...","budgetMax":0,"useCase":"...","brand":"..."}',
        }
      );
      detectedIntent = intentResult.data as typeof detectedIntent;
    } catch {
      // Fallback: continue without intent detection
    }
  }

  // Apply detected intent
  if (detectedIntent.category && !category) {
    filter.$or = [
      { category: { $regex: detectedIntent.category, $options: "i" } },
      { title: { $regex: detectedIntent.category, $options: "i" } },
      { tags: { $in: [new RegExp(detectedIntent.category, "i")] } },
    ];
  }
  if (detectedIntent.budgetMax && !maxPrice) {
    filter.price = { ...(filter.price as object), $lte: detectedIntent.budgetMax };
  }

  // Apply explicit filters
  if (category) filter.category = { $regex: category, $options: "i" };
  if (brand) filter.$or = [{ title: { $regex: brand, $options: "i" } }, { tags: { $in: [new RegExp(brand, "i")] } }];
  if (seller) filter.sellerId = seller;
  if (rating) filter.ratingAvg = { $gte: Number(rating) };
  if (availability === "in_stock") filter.stock = { $gt: 0 };
  if (availability === "out_of_stock") filter.stock = { $lte: 0 };

  // Price range
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) (filter.price as any).$gte = Number(minPrice);
    if (maxPrice) (filter.price as any).$lte = Number(maxPrice);
  }

  // Text search if no structured category filter
  if (!filter.$or && !category) {
    filter.$text = { $search: searchTerm };
  }

  // Sorting
  let sortOption: Record<string, 1 | -1 | { $meta: string }> = { score: { $meta: "textScore" } };
  switch (sort) {
    case "price_asc":
      sortOption = { price: 1 };
      break;
    case "price_desc":
      sortOption = { price: -1 };
      break;
    case "rating":
      sortOption = { ratingAvg: -1 };
      break;
    case "popular":
      sortOption = { sold: -1 };
      break;
    case "newest":
      sortOption = { createdAt: -1 };
      break;
    default:
      sortOption = filter.$text ? { score: { $meta: "textScore" } } : { ratingAvg: -1, sold: -1 };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sortOption).skip(skip).limit(limitNum),
    Product.countDocuments(filter),
  ]);

  // Save search history
  if (userId !== "anonymous") {
    await SearchHistory.create({
      userId,
      query: searchTerm,
      filters: {
        category: category || detectedIntent.category,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : detectedIntent.budgetMax,
        brand,
        rating: rating ? Number(rating) : undefined,
        seller,
        availability,
      },
      resultCount: total,
    });
  }

  sendSuccess(res, {
    products,
    intent: detectedIntent,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// Search suggestions
export const getSearchSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  if (!q || q.length < 2) {
    return sendSuccess(res, { suggestions: [], recentSearches: [] });
  }

  // Get popular matching products
  const matchingProducts = await Product.find({
    isDeleted: false,
    status: "approved",
    $or: [
      { title: { $regex: q, $options: "i" } },
      { tags: { $in: [new RegExp(q, "i")] } },
    ],
  })
    .sort({ sold: -1 })
    .limit(5)
    .select("title category");

  const suggestions = matchingProducts.map((p) => p.title);

  // Get recent searches for logged-in user
  let recentSearches: string[] = [];
  const userId = req.user?.id;
  if (userId) {
    const recent = await SearchHistory.find({ userId }).sort({ createdAt: -1 }).limit(5).select("query");
    recentSearches = recent.map((r) => r.query);
  }

  sendSuccess(res, { suggestions, recentSearches });
});

// Get search history
export const getSearchHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous";
  const history = await SearchHistory.find({ userId }).sort({ createdAt: -1 }).limit(20);
  sendSuccess(res, history);
});

// Clear search history
export const clearSearchHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized();
  await SearchHistory.deleteMany({ userId });
  sendSuccess(res, { cleared: true }, "Search history cleared");
});

// ============================================================
// 2. PERSONAL AI SHOPPING AGENT (Feature 2)
// ============================================================
export const shoppingAgentChat = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous";
  const { message, context } = req.body as { message: string; context?: string };

  if (!message || message.trim().length === 0) {
    throw ApiError.badRequest("Message is required");
  }

  // Gather user context
  const [recentOrders, wishlist, preferences] = await Promise.all([
    Order.find({ userId }).sort({ createdAt: -1 }).limit(5).select("items totalAmount status"),
    import("../wishlist/wishlist.model").then((m) => m.Wishlist.findOne({ userId })),
    UserPreferences.findOne({ userId }),
  ]);

  // Build context for AI
  const userContext = {
    recentPurchases: recentOrders.map((o) => ({
      items: o.items.map((i) => i.title),
      total: o.totalAmount,
      status: o.status,
    })),
    wishlistCount: wishlist?.items?.length || 0,
    preferredCategories: preferences?.preferredCategories || [],
    typicalBudget: preferences ? `৳${preferences.typicalBudgetMin}-৳${preferences.typicalBudgetMax}` : "not set",
  };

  // Get relevant products based on message
  const lowerMessage = message.toLowerCase();
  const productFilter: Record<string, unknown> = { isDeleted: false, status: "approved", stock: { $gt: 0 } };

  // Extract budget from message
  const budgetMatch = lowerMessage.match(/(?:under|below|less than|within|budget|max|মধ্যে|কম|এর নিচে)\s*(?:৳|tk|taka|rs)?\s*([\d,]+(?:\s*(?:hazar|হাজার|lakh|লক্ষ|k)?))/i);
  let budgetMax = 0;
  if (budgetMatch) {
    const numStr = budgetMatch[1].replace(/,/g, "");
    budgetMax = parseInt(numStr, 10);
    if (lowerMessage.includes("হাজার") || lowerMessage.includes("hazar") || lowerMessage.includes("k")) {
      budgetMax *= 1000;
    }
    if (lowerMessage.includes("লক্ষ") || lowerMessage.includes("lakh")) {
      budgetMax *= 100000;
    }
    productFilter.price = { $lte: budgetMax };
  }

  // Find matching products
  const relevantProducts = await Product.find({
    ...productFilter,
    $or: [
      { title: { $regex: lowerMessage.split(" ").filter((w) => w.length > 3).join("|"), $options: "i" } },
      { category: { $regex: lowerMessage.split(" ").filter((w) => w.length > 3).join("|"), $options: "i" } },
    ],
  })
    .sort({ ratingAvg: -1, sold: -1 })
    .limit(5);

  let aiResponse: string;
  let isFallback = false;
  let suggestedProducts = relevantProducts.map((p) => ({
    id: p.id,
    title: p.title,
    price: p.discountPrice || p.price,
    category: p.category,
    image: p.images[0] || "",
    ratingAvg: p.ratingAvg,
  }));

  const aiContext: AiContext = {
    userContext,
    products: suggestedProducts,
    orders: recentOrders.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount })),
  };

  try {
    const aiResult = await completeWithContext(
      [
        {
          role: "user",
          content: `User context: ${JSON.stringify(userContext)}\nAvailable products: ${JSON.stringify(suggestedProducts)}\nUser question: "${message}"\n\nHelp the user with product recommendations, comparisons, budget advice, and shopping guidance. Be specific about products when possible. Respond in the same language as the user (English or Bengali).`,
        },
      ],
      aiContext,
      {
        system: `You are ShopNest AI Shopping Assistant for Bangladesh. Help customers find products, compare options, suggest budgets, and provide shopping guidance. Be helpful, specific, and honest. If you recommend products, use the available products list. Use ৳ for currency. Keep responses concise but informative.`,
      }
    );
    aiResponse = aiResult.content;
    isFallback = aiResult.isFallback;
  } catch (err) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId,
      endpoint: "/ai/shopping-agent",
      input: message,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback response using real data
    aiResponse = suggestedProducts.length > 0
      ? `I found ${suggestedProducts.length} products${budgetMax > 0 ? ` within your ৳${budgetMax.toLocaleString()} budget` : ""} that might interest you. Check the recommendations below.`
      : budgetMax > 0
        ? `I couldn't find any products matching your criteria within ৳${budgetMax.toLocaleString()}. Try adjusting your budget or search terms.`
        : "I'd be happy to help you find what you're looking for! Could you tell me more about your budget or specific needs?";
    isFallback = true;
  }

  sendSuccess(res, {
    response: aiResponse,
    suggestedProducts,
    detectedBudget: budgetMax > 0 ? budgetMax : undefined,
    isFallback,
  });
});

// ============================================================
// 3. AI GIFT FINDER (Feature 19)
// ============================================================
export const giftFinder = asyncHandler(async (req: Request, res: Response) => {
  const { occasion, relationship, ageRange, budget, interests, gender } = req.body as {
    occasion?: string;
    relationship?: string;
    ageRange?: string;
    budget?: number;
    interests?: string;
    gender?: string;
  };

  if (!budget || budget <= 0) {
    throw ApiError.badRequest("Budget is required");
  }

  // Build search filter
  const filter: Record<string, unknown> = {
    isDeleted: false,
    status: "approved",
    stock: { $gt: 0 },
    price: { $lte: budget },
  };

  // Find products within budget
  let products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(20);

  // Filter by interests/occasion if provided
  if (interests || occasion) {
    const keywords = [interests, occasion, relationship].filter(Boolean).join(" ").toLowerCase();
    const filtered = products.filter((p) => {
      const text = `${p.title} ${p.category} ${p.tags.join(" ")} ${p.description}`.toLowerCase();
      return keywords.split(" ").some((kw) => kw.length > 2 && text.includes(kw));
    });
    if (filtered.length > 0) products = filtered;
  }

  const recommendedProducts = products.slice(0, 8).map((p) => ({
    id: p.id,
    title: p.title,
    price: p.discountPrice || p.price,
    originalPrice: p.price,
    category: p.category,
    image: p.images[0] || "",
    ratingAvg: p.ratingAvg,
    reason: `${occasion ? `Perfect for ${occasion}` : "Great gift choice"} ${relationship ? `for ${relationship}` : ""}`,
  }));

  let aiSuggestion = "";
  let isFallback = false;
  try {
    const result = await completeWithContext(
      [
        {
          role: "user",
          content: `Occasion: ${occasion || "general"}, Relationship: ${relationship || "friend"}, Age: ${ageRange || "any"}, Budget: ৳${budget}, Interests: ${interests || "general"}, Gender: ${gender || "any"}. Products: ${JSON.stringify(recommendedProducts.map((p) => ({ title: p.title, price: p.price, category: p.category })))}. Give a brief gift recommendation summary.`,
        },
      ],
      { products: recommendedProducts },
      {
        system: "You are a gift advisor for a Bangladeshi e-commerce platform. Give warm, personalized gift suggestions in 2-3 sentences. Use ৳ for currency.",
      }
    );
    aiSuggestion = result.content;
    isFallback = result.isFallback;
  } catch {
    aiSuggestion = recommendedProducts.length > 0
      ? `Found ${recommendedProducts.length} great gift options within your ৳${budget.toLocaleString()} budget!`
      : `I couldn't find any gift options within ৳${budget.toLocaleString()}. Try increasing your budget.`;
    isFallback = true;
  }

  sendSuccess(res, {
    occasion: occasion || "general",
    budget,
    recommendations: recommendedProducts,
    aiSuggestion,
    isFallback,
  });
});

// ============================================================
// 4. AI REVIEW ASSISTANT (Feature 20)
// ============================================================
export const generateReviewDraft = asyncHandler(async (req: Request, res: Response) => {
  const { productId, quality, delivery, packaging, value, overallExperience } = req.body as {
    productId: string;
    quality?: number;
    delivery?: number;
    packaging?: number;
    value?: number;
    overallExperience?: string;
  };

  if (!productId) {
    throw ApiError.badRequest("Product ID is required");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const ratings = {
    quality: quality || 4,
    delivery: delivery || 4,
    packaging: packaging || 4,
    value: value || 4,
  };
  const avgRating = Math.round(((ratings.quality + ratings.delivery + ratings.packaging + ratings.value) / 4) * 10) / 10;

  let reviewDraft = "";
  let isFallback = false;
  try {
    const result = await completeWithContext(
      [
        {
          role: "user",
          content: `Product: ${product.title} (${product.category}). Ratings: Quality=${ratings.quality}/5, Delivery=${ratings.delivery}/5, Packaging=${ratings.packaging}/5, Value=${ratings.value}/5. Overall: ${overallExperience || "satisfactory"}. Generate a helpful, balanced product review draft (2-4 sentences) that the customer can edit before submitting.`,
        },
      ],
      { productName: product.title, category: product.category },
      {
        system: "You are a review writing assistant. Generate honest, balanced review drafts based on the customer's ratings. The review should be helpful to other buyers. Keep it natural and authentic. Output ONLY the review text, no explanations.",
      }
    );
    reviewDraft = result.content;
    isFallback = result.isFallback;
  } catch {
    reviewDraft = `The ${product.title} is a solid ${product.category.toLowerCase()} option. ${ratings.quality >= 4 ? "Good quality build and performance." : "Quality could be better."} ${ratings.value >= 4 ? "Value for money is decent." : "A bit pricey for what you get."} ${ratings.delivery >= 4 ? "Delivery was on time." : "Delivery took longer than expected."}`;
    isFallback = true;
  }

  sendSuccess(res, {
    productId,
    productTitle: product.title,
    reviewDraft,
    suggestedRatings: ratings,
    averageRating: avgRating,
    note: "This is a draft. Please edit and personalize before submitting.",
    isFallback,
  });
});

// ============================================================
// 5. SMART DEAL FINDER (Feature 5)
// ============================================================
export const smartDealFinder = asyncHandler(async (req: Request, res: Response) => {
  const { budget, category, purpose, features } = req.body as {
    budget: number;
    category?: string;
    purpose?: string;
    features?: string;
  };

  if (!budget || budget <= 0) {
    throw ApiError.badRequest("Budget is required");
  }

  const filter: Record<string, unknown> = {
    isDeleted: false,
    status: "approved",
    stock: { $gt: 0 },
    price: { $lte: budget },
  };

  if (category) filter.category = { $regex: category, $options: "i" };

  const products = await Product.find(filter).limit(50);

  // Score and rank products
  const storeIds = [...new Set(products.map((p) => p.storeId))];
  const stores = await Store.find({ _id: { $in: storeIds } }).select("storeName trustScore rating");
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const scoredProducts = products.map((p) => {
    const store = storeMap.get(p.storeId);
    const discountRatio = p.discountPrice ? (p.price - p.discountPrice) / p.price : 0;
    const priceScore = Math.max(0, 100 - (p.price / budget) * 100);
    const ratingScore = (p.ratingAvg / 5) * 100;
    const trustScore = (store?.trustScore || 70);
    const discountScore = discountRatio * 100;
    const reviewScore = Math.min(100, (p.ratingCount / 50) * 100);

    const valueScore = Math.round(
      priceScore * 0.25 + ratingScore * 0.25 + trustScore * 0.2 + discountScore * 0.15 + reviewScore * 0.15
    );

    return {
      id: p.id,
      title: p.title,
      price: p.discountPrice || p.price,
      originalPrice: p.price,
      discountPercent: Math.round(discountRatio * 100),
      category: p.category,
      image: p.images[0] || "",
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      seller: store?.storeName || "Unknown",
      trustScore: store?.trustScore || 70,
      valueScore,
      inStock: p.stock > 0,
    };
  });

  // Sort by value score
  scoredProducts.sort((a, b) => b.valueScore - a.valueScore);

  sendSuccess(res, {
    budget,
    purpose: purpose || "general",
    totalFound: scoredProducts.length,
    deals: scoredProducts.slice(0, 12),
  });
});
