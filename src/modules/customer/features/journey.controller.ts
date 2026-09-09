import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { ShoppingJourney } from "../customer-intelligence.model";
import { SearchHistory } from "../customer-features.model";
import { CustomerActivity } from "../customer-extras.model";
import { getUserId } from "../../../utils/getUserId";

export function normalizeCustomerActivityType(input: string | undefined): string {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "view";

  const map: Record<string, string> = {
    product_view: "view",
    view: "view",
    product_viewed: "view",
    browse: "view",
    search: "search",
    query: "search",
    wishlist_add: "wishlist_add",
    wishlist: "wishlist_add",
    add_wishlist: "wishlist_add",
    cart_add: "cart_add",
    cart: "cart_add",
    add_cart: "cart_add",
    order: "purchase",
    purchase: "purchase",
    checkout: "checkout",
    checkout_started: "checkout",
    category_browse: "category_browse",
    category_view: "category_browse",
    review: "review",
    security: "security",
  };

  return map[raw] || raw;
}

// SMART SHOPPING JOURNEY
export const getShoppingJourney = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    return sendSuccess(res, {
      journey: null,
      recommendedItems: [],
    });
  }

  // Populate product details for recommendations
  const recommendedItems = await Product.find({
    _id: { $in: journey.recommendedProducts || [] },
    isDeleted: false,
  }).limit(4);

  sendSuccess(res, {
    journey: journey.toJSON(),
    recommendedItems,
  });
});

export const recordJourneyEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { eventType, productId, productTitle, category, price, metadata } = req.body;

  let journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    journey = new ShoppingJourney({
      userId,
      category: category || "Electronics",
      currentStage: "discovery",
      journeyProgress: 20,
      events: [],
    });
  }

  journey.events.push({
    eventType,
    productId,
    productTitle,
    category,
    price,
    metadata,
    createdAt: new Date(),
  });

  // Dynamically update progress & stage
  const eventTypes = journey.events.map((e) => e.eventType);
  if (eventTypes.includes("purchase")) {
    journey.currentStage = "completed";
    journey.journeyProgress = 100;
  } else if (eventTypes.includes("cart_add")) {
    journey.currentStage = "ready_to_buy";
    journey.journeyProgress = 80;
  } else if (eventTypes.includes("wishlist_add") || eventTypes.filter((t) => t === "view").length >= 3) {
    journey.currentStage = "intent";
    journey.journeyProgress = 60;
  } else if (eventTypes.filter((t) => t === "view").length >= 1) {
    journey.currentStage = "evaluation";
    journey.journeyProgress = 40;
  }

  await journey.save();

  const normalizedType = normalizeCustomerActivityType(eventType);
  const activityMetadata: Record<string, unknown> = {
    ...(metadata || {}),
  };
  if (productId) activityMetadata.productId = productId;
  if (productTitle) activityMetadata.productTitle = productTitle;
  if (category) activityMetadata.category = category;
  if (typeof price === "number") activityMetadata.price = price;

  await CustomerActivity.create({
    userId,
    activityType: normalizedType,
    title: productTitle || normalizedType,
    details: category ? `${normalizedType} on ${category}` : undefined,
    metadata: activityMetadata,
  });

  sendSuccess(res, journey.toJSON(), "Journey event recorded");
});

export const getJourneyAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { range = "30d", type, page = "1", limit = "20" } = req.query as {
    range?: string;
    type?: string;
    page?: string;
    limit?: string;
  };

  const now = new Date();
  const rangeMs = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "all": 365 * 24 * 60 * 60 * 1000,
  }[range || "30d"] || 30 * 24 * 60 * 60 * 1000;

  const rangeStart = new Date(now.getTime() - rangeMs);
  const pageNum = Number(page) || 1;
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const activities = await CustomerActivity.find({
    userId,
    createdAt: { $gte: rangeStart },
  })
    .sort({ createdAt: -1 })
    .lean();

  const events = activities.map((activity) => {
    const typeName = normalizeCustomerActivityType(activity.activityType);
    const metadata = (activity.metadata as Record<string, unknown> | undefined) || {};
    const productId = typeof metadata.productId === "string" ? metadata.productId : typeof metadata.product_id === "string" ? metadata.product_id : undefined;
    const productTitle = typeof metadata.productTitle === "string" ? metadata.productTitle : typeof metadata.productTitle === "string" ? metadata.productTitle : activity.title;
    const category = typeof metadata.category === "string" ? metadata.category : undefined;
    const price = typeof metadata.price === "number" ? metadata.price : undefined;

    return {
      eventType: typeName,
      productId,
      productTitle,
      category,
      price,
      metadata,
      createdAt: activity.createdAt,
      id: String(activity._id),
    };
  });

  const filtered = type ? events.filter((e) => e.eventType === type) : events;

  const totalActivities = filtered.length;
  const productsViewed = filtered.filter((e) => e.eventType === "view").length;
  const searches = filtered.filter((e) => e.eventType === "search").length;
  const wishlistAdds = filtered.filter((e) => e.eventType === "wishlist_add").length;
  const cartAdds = filtered.filter((e) => e.eventType === "cart_add").length;
  const purchases = filtered.filter((e) => e.eventType === "purchase").length;

  const sortedEvents = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const timeline = sortedEvents.slice(skip, skip + limitNum).map((e) => ({
    id: `${String(e.id)}-${String(e.eventType)}`,
    eventType: e.eventType,
    productId: e.productId,
    productTitle: e.productTitle,
    category: e.category,
    price: e.price,
    metadata: e.metadata,
    createdAt: e.createdAt,
  }));

  const recentSearches = await SearchHistory.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
  const recentSearchesMapped = recentSearches
    .filter((item) => item?.query)
    .map((item) => ({
      query: item.query,
      createdAt: item.createdAt,
    }));

  const viewedProductMap = new Map<string, { productId: string; productTitle: string; category?: string; price?: number; count: number }>();
  filtered.filter((e) => e.eventType === "view" && e.productId).forEach((e) => {
    const existing = viewedProductMap.get(e.productId!) || {
      productId: e.productId!,
      productTitle: e.productTitle || "",
      category: e.category,
      price: e.price,
      count: 0,
    };
    existing.count += 1;
    viewedProductMap.set(e.productId!, existing);
  });
  const mostViewedProducts = Array.from(viewedProductMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

  const wishlistActivity = filtered
    .filter((e) => e.eventType === "wishlist_add")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
    .map((e) => ({
      productId: e.productId,
      productTitle: e.productTitle,
      price: e.price,
      createdAt: e.createdAt,
    }));

  const cartActivity = filtered
    .filter((e) => e.eventType === "cart_add")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
    .map((e) => ({
      productId: e.productId,
      productTitle: e.productTitle,
      price: e.price,
      createdAt: e.createdAt,
    }));

  const purchaseActivity = filtered
    .filter((e) => e.eventType === "purchase")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
    .map((e) => ({
      productId: e.productId,
      productTitle: e.productTitle,
      price: e.price,
      orderId: typeof e.metadata?.orderId === "string" ? e.metadata.orderId : undefined,
      createdAt: e.createdAt,
    }));

  const discoveryCount = filtered.filter((e) => e.eventType === "category_browse" || e.eventType === "search").length;
  const viewCount = productsViewed;
  const wishlistCount = wishlistAdds;
  const cartCount = cartAdds;
  const checkoutCount = filtered.filter((e) => e.eventType === "checkout").length;
  const purchaseCount = purchases;

  const funnel =
    discoveryCount > 0 || viewCount > 0 || wishlistCount > 0 || cartCount > 0 || purchaseCount > 0
      ? {
          discovery: { count: discoveryCount, percentage: discoveryCount > 0 ? 100 : 0 },
          views: { count: viewCount, percentage: discoveryCount > 0 ? Math.round((viewCount / discoveryCount) * 100) : 0 },
          wishlist: { count: wishlistCount, percentage: discoveryCount > 0 ? Math.round((wishlistCount / discoveryCount) * 100) : 0 },
          cart: { count: cartCount, percentage: discoveryCount > 0 ? Math.round((cartCount / discoveryCount) * 100) : 0 },
          checkout: { count: checkoutCount, percentage: discoveryCount > 0 ? Math.round((checkoutCount / discoveryCount) * 100) : 0 },
          purchase: { count: purchaseCount, percentage: discoveryCount > 0 ? Math.round((purchaseCount / discoveryCount) * 100) : 0 },
        }
      : null;

  const categoryMap = new Map<string, { category: string; interactions: number; productIds: Set<string> }>();
  filtered.forEach((e) => {
    if (!e.category) return;
    const existing = categoryMap.get(e.category) || { category: e.category, interactions: 0, productIds: new Set() };
    existing.interactions += 1;
    if (e.productId) existing.productIds.add(e.productId);
    categoryMap.set(e.category, existing);
  });

  const interests = Array.from(categoryMap.values())
    .sort((a, b) => b.interactions - a.interactions)
    .slice(0, 5)
    .map((item) => ({
      category: item.category,
      interactions: item.interactions,
      uniqueProducts: item.productIds.size,
    }));

  if (activities.length === 0) {
    const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });
    if (!journey) {
      return sendSuccess(res, {
        stats: {
          totalActivities: 0,
          productsViewed: 0,
          searches: 0,
          wishlistAdds: 0,
          cartAdds: 0,
          purchases: 0,
        },
        timeline: [],
        recentSearches: [],
        mostViewedProducts: [],
        wishlistActivity: [],
        cartActivity: [],
        purchaseActivity: [],
        funnel: null,
        interests: [],
      });
    }
  }

  sendSuccess(res, {
    stats: {
      totalActivities,
      productsViewed,
      searches,
      wishlistAdds,
      cartAdds,
      purchases,
    },
    timeline,
    pagination: {
      total: filtered.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(filtered.length / limitNum),
    },
    recentSearches: recentSearchesMapped,
    mostViewedProducts,
    wishlistActivity,
    cartActivity,
    purchaseActivity,
    funnel,
    interests,
  });
});
