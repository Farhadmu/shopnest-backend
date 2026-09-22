import { Request, Response } from "express";
import mongoose from "mongoose";
import { Product, IProduct, IProductVariant, IProductHighlight } from "./product.model";
import { Store } from "../sellers/store.model";
import { Category } from "../categories/category.model";
import { Review } from "../reviews/review.model";
import { Courier } from "../delivery/courier.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { ACTIVE_PRODUCT_FILTER, buildPublicProductFilter, EXCLUDED_STORE_STATUSES } from "../../utils/activeProductFilter";
import { getSellerStore } from "../sellers/seller-store.util";
import { resolveCategoryNames } from "../../utils/category.utils";
import { normalizeLeanArray, normalizeLean } from "../../utils/model-plugins";

const LIST_CACHE_TTL_MS = 2 * 60 * 1000;
const listCache = new Map<string, { value: { products: Record<string, unknown>[]; total: number; hasMore: boolean }; expiresAt: number }>();

function isCacheableQuery(query: Record<string, string | undefined>): boolean {
  if (query.search) return false;
  if (query.category || query.categories) return false;
  if (query.ids || query.products) return false;
  if (query.seller || query.sellerId) return false;
  if (query.store || query.storeId) return false;
  if (query.minPrice !== undefined || query.maxPrice !== undefined) return false;
  if (query.rating || query.productRating) return false;
  if (query.verified === "true" || query.verified === "1" || query.inStock === "true" || query.inStock === "1" || query.aiPick === "true" || query.aiPick === "1" || query.freeDelivery === "true" || query.freeDelivery === "1") return false;
  if (query.status && query.status !== "approved") return false;
  if (query.isFeatured !== undefined) return false;
  if (query.sort && query.sort !== "newest") return false;
  return true;
}

function buildListCacheKey(query: Record<string, string | undefined>, sortOption: Record<string, 1 | -1>, page: number, limit: number): string {
  return JSON.stringify({ q: query, s: sortOption, p: page, l: limit });
}

function getFromListCache(key: string): { products: Record<string, unknown>[]; total: number; hasMore: boolean } | null {
  const cached = listCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  listCache.delete(key);
  return null;
}

function setListCache(key: string, value: { products: Record<string, unknown>[]; total: number; hasMore: boolean }): void {
  listCache.set(key, { value, expiresAt: Date.now() + LIST_CACHE_TTL_MS });
}

export function clearListCache(): void {
  listCache.clear();
}

function resolveStore(identifier: string) {
  const normalizedIdentifier = identifier.toLowerCase();

  return Store.findOne({
    $or: [
      { slug: normalizedIdentifier },
      { ownerId: identifier },
      ...(mongoose.isValidObjectId(identifier) ? [{ _id: identifier }] : []),
    ],
  }).lean();
}

/**
 * Builds the public product filter from the validated `/products` list query.
 * Shared by the list endpoint and the category counts endpoint so both always
 * narrow the catalog in exactly the same way. `category` is deliberately left
 * to the caller, since the counts endpoint needs the total across categories.
 */
async function buildProductFilter(
  query: Record<string, string | undefined>
): Promise<Record<string, unknown>> {
  const baseFilter: Record<string, unknown> = {};

  if (query.search) {
    baseFilter.$text = { $search: query.search };
  }
  if (query.storeId) {
    baseFilter.storeId = query.storeId;
  }
  if (query.store) {
    const store = await resolveStore(query.store);
    if (store) {
      baseFilter.storeId = store._id.toString();
    } else {
      baseFilter.storeId = null;
    }
  }
  const rawProductIds = query.ids || query.products;
  if (rawProductIds) {
    const ids = rawProductIds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => mongoose.isValidObjectId(s));
    if (ids.length > 0) {
      baseFilter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
    }
  }
  if (query.sellerId) {
    baseFilter.sellerId = query.sellerId;
  }
  if (query.seller) {
    const rawIds = query.seller.split(",").map((s) => s.trim()).filter(Boolean);
    const validRawObjectIds = rawIds.filter((s) => mongoose.isValidObjectId(s));
    const storeQueryOr: Record<string, unknown>[] = [
      { slug: { $in: rawIds.map((s) => s.toLowerCase()) } },
      { ownerId: { $in: rawIds } },
      { storeName: { $in: rawIds.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) } },
    ];
    if (validRawObjectIds.length > 0) {
      storeQueryOr.push({ _id: { $in: validRawObjectIds } });
    }

    const stores = await Store.find({ $or: storeQueryOr }).lean();

    const ownerIds = stores.map((s) => s.ownerId).filter(Boolean);
    const storeIds = stores.map((s) => s._id.toString());
    const slugs = stores.map((s) => s.slug).filter(Boolean);

    const allSellerKeys = Array.from(new Set([...ownerIds, ...rawIds]));
    const allStoreKeys = Array.from(new Set([...storeIds, ...validRawObjectIds, ...slugs, ...rawIds]));

    baseFilter.$or = [
      { sellerId: { $in: allSellerKeys } },
      { storeId: { $in: allStoreKeys } },
    ];
  }
  if (query.rating) {
    baseFilter.ratingAvg = { $gte: Number(query.rating) };
  }
  if (query.productRating) {
    baseFilter.ratingAvg = { $gte: Number(query.productRating) };
  }
  if (query.verified === "true" || query.verified === "1") {
    baseFilter.freeDelivery = true;
  }
  if (query.inStock === "true" || query.inStock === "1") {
    baseFilter.stock = { $gt: 0 };
  }
  if (query.freeDelivery === "true" || query.freeDelivery === "1") {
    baseFilter.freeDelivery = true;
  }
  if (query.aiPick === "true" || query.aiPick === "1") {
    baseFilter.aiPick = true;
  }
  if (query.isFeatured === "true" || query.isFeatured === "1") {
    baseFilter.isFeatured = true;
  } else if (query.isFeatured === "false" || query.isFeatured === "0") {
    baseFilter.isFeatured = false;
  }
  if (query.minPrice !== undefined) {
    baseFilter.price = { ...(baseFilter.price as Record<string, unknown> || {}), $gte: Number(query.minPrice) };
  }
  if (query.maxPrice !== undefined) {
    baseFilter.price = { ...(baseFilter.price as Record<string, unknown> || {}), $lte: Number(query.maxPrice) };
  }
  if (query.status && query.status !== "approved") {
    baseFilter.$and = [
      ...(Array.isArray(baseFilter.$and) ? (baseFilter.$and as unknown[]) : []),
      { status: query.status },
    ];
  }

  const filter = await buildPublicProductFilter(baseFilter);
  return filter;
}

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 12));
  const skip = (page - 1) * limit;

  const filter = await buildProductFilter(query);

  const rawCategory = query.category || query.categories;
  if (rawCategory) {
    const names = await resolveCategoryNames(rawCategory);
    if (names.length > 0) {
      const regexPatterns = names.map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
      filter.category = { $in: regexPatterns };
    }
  }

  let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
  switch (query.sort) {
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
    case "featured":
      sortOption = { isFeatured: -1, createdAt: -1 };
      break;
    case "newest":
    default:
      sortOption = { createdAt: -1 };
      break;
  }

  const skipExactCount = query.exactCount === "false";
  const bypassCache = (req.headers && req.headers["x-no-cache"] !== undefined) || query.nocache !== undefined;
  const canCache = isCacheableQuery(query) && !skipExactCount && !bypassCache;

  if (canCache) {
    const cacheKey = buildListCacheKey(query, sortOption, page, limit);
    const cached = getFromListCache(cacheKey);
    if (cached) {
      res.set("X-Total-Count", String(cached.total));
      res.set("X-Page", String(page));
      res.set("X-Limit", String(limit));
      res.set("X-Cache", "HIT");
      sendSuccess(res, cached.products);
      return;
    }
  }

  if (skipExactCount) {
    const products = await Product.find(filter)
      .select("title description price discountPrice images imageUrl category storeId sellerId stock status ratingAvg ratingCount sold views isFeatured freeDelivery aiPick createdAt updatedAt tags specifications variants highlights packageContents")
      .sort(sortOption)
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasMore = products.length > limit;
    res.set("X-Has-More", String(hasMore));
    res.set("X-Page", String(page));
    res.set("X-Limit", String(limit));
    sendSuccess(res, normalizeLeanArray(products.slice(0, limit) as Record<string, unknown>[]));
    return;
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .select("title description price discountPrice images imageUrl category storeId sellerId stock status ratingAvg ratingCount sold views isFeatured freeDelivery aiPick createdAt updatedAt tags specifications variants highlights packageContents")
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.set("X-Total-Count", String(total));
  res.set("X-Page", String(page));
  res.set("X-Limit", String(limit));

  const normalizedProducts = normalizeLeanArray(products as Record<string, unknown>[]);

  if (canCache) {
    setListCache(buildListCacheKey(query, sortOption, page, limit), {
      products: normalizedProducts,
      total,
      hasMore: false,
    });
    res.set("X-Cache", "MISS");
  }

  sendSuccess(res, normalizedProducts);
});

export const getStoreOptions = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await Store.find({ status: "approved" })
    .select("_id storeName slug rating trustScore")
    .lean();

  const grouped = await Product.aggregate([
    { $match: ACTIVE_PRODUCT_FILTER },
    { $group: { _id: "$storeId", count: { $sum: 1 } } },
  ]);

  const byStoreId = new Map(grouped.map((row) => [String(row._id), row.count]));

  const options = stores.map((store) => ({
    id: store._id.toString(),
    name: store.storeName,
    rating: store.rating,
    productCount: byStoreId.get(store._id.toString()) ?? 0,
  }));

  sendSuccess(res, options);
});

export const getSellerOptions = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await Store.find({ status: "approved" })
    .select("_id storeName slug ownerId rating trustScore")
    .lean();

  const grouped = await Product.aggregate([
    { $match: ACTIVE_PRODUCT_FILTER },
    { $group: { _id: "$storeId", count: { $sum: 1 } } },
  ]);

  const byStoreId = new Map(grouped.map((row) => [String(row._id), row.count]));

  const options = stores.map((store) => ({
    id: store._id.toString(),
    slug: store.slug,
    ownerId: store.ownerId,
    name: store.storeName,
    rating: store.rating,
    productCount: byStoreId.get(store._id.toString()) ?? 0,
  }));

  sendSuccess(res, options);
});

/**
 * Per-category product counts for the current filters, in a single round trip.
 * Replaces one `/products` request per category: `total` matches the unfiltered
 * category count and each entry mirrors `resolveCategoryNames`' subtree
 * semantics (a parent's count includes its descendants).
 */
export const getCategoryCounts = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;

  const filter = await buildProductFilter(query);

  const [grouped, categories] = await Promise.all([
    Product.aggregate<{ _id: string | null; count: number }>([
      { $match: filter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    Category.find().select("name parent").lean(),
  ]);

  let total = 0;
  const directCounts = new Map<string, number>();
  for (const row of grouped) {
    total += row.count;
    if (typeof row._id === "string") directCounts.set(row._id, row.count);
  }

  const childrenByParent = new Map<string, { id: string; name: string }[]>();
  for (const category of categories) {
    const parentId = category.parent ? String(category.parent) : "";
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId)!.push({ id: String(category._id), name: category.name });
  }

  const subtreeCount = (id: string, name: string): number => {
    let sum = directCounts.get(name) ?? 0;
    for (const child of childrenByParent.get(id) ?? []) {
      sum += subtreeCount(child.id, child.name);
    }
    return sum;
  };

  const counts: Record<string, number> = {};
  for (const category of categories) {
    counts[category.name] = subtreeCount(String(category._id), category.name);
  }

  sendSuccess(res, { total, counts });
});

export const listMyProducts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const store = await getSellerStore(userId);

  const ownership: Record<string, unknown>[] = [{ sellerId: userId }];
  if (store) {
    ownership.push({ storeId: store._id.toString() }, { storeId: store._id });
  }

  const products = await Product.find({
    $or: ownership,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, normalizeLeanArray(products as Record<string, unknown>[]));
});

export const getTrendingProducts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));

  const filter = await buildPublicProductFilter({ stock: { $gt: 0 } });

  const products = await Product.find(filter)
    .sort({ sold: -1, ratingAvg: -1 })
    .limit(limit)
    .lean();

  const normalized = normalizeLeanArray(products as Record<string, unknown>[]);
  sendSuccess(res, { count: normalized.length, products: normalized });
});

export const getFeaturedProducts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));

  const filter = await buildPublicProductFilter({ isFeatured: true, stock: { $gt: 0 } });

  const products = await Product.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const normalized = normalizeLeanArray(products as Record<string, unknown>[]);
  sendSuccess(res, normalized);
});

export const getCompareProducts = asyncHandler(async (req: Request, res: Response) => {
  const idsQuery = req.query.ids;
  let ids: string[] = [];
  if (typeof idsQuery === "string") {
    ids = idsQuery.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(idsQuery)) {
    ids = (idsQuery as string[]).map((s) => String(s).trim()).filter(Boolean);
  }

  if (ids.length === 0) {
    sendSuccess(res, []);
    return;
  }

  const validIds = ids.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) {
    sendSuccess(res, []);
    return;
  }

  const filter = await buildPublicProductFilter({ _id: { $in: validIds } });
  const rawProducts = await Product.find(filter).lean();

  // Preserve user requested order
  const productMap = new Map(rawProducts.map((p) => [String(p._id), p]));
  const products = validIds
    .map((id) => productMap.get(id))
    .filter(Boolean) as (typeof rawProducts[0])[];

  if (products.length === 0) {
    sendSuccess(res, []);
    return;
  }

  // Fetch store information
  const storeIds = Array.from(new Set(products.map((p) => p.storeId).filter(Boolean)));
  const stores = await Store.find({
    $or: [
      { ownerId: { $in: storeIds } },
      { _id: { $in: storeIds.filter((id) => mongoose.isValidObjectId(id)) } },
    ],
  })
    .select("_id ownerId storeName slug rating ratingCount trustScore businessInfo location verifiedAt createdAt")
    .lean();

  const storeMap = new Map<string, (typeof stores)[0]>();
  for (const s of stores) {
    if (s.ownerId) storeMap.set(s.ownerId, s);
    storeMap.set(String(s._id), s);
  }

  // Fetch reviews aggregation for each product
  const foundProductIds = products.map((p) => String(p._id));
  const reviewStats = await Review.aggregate([
    { $match: { productId: { $in: foundProductIds } } },
    {
      $group: {
        _id: "$productId",
        totalCount: { $sum: 1 },
        avgRating: { $avg: "$rating" },
        verifiedCount: { $sum: { $cond: ["$verifiedPurchase", 1, 0] } },
        stars1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
        stars2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
        stars3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
        stars4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
        stars5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
      },
    },
  ]);

  const statsMap = new Map(reviewStats.map((r) => [String(r._id), r]));

  // Fetch top recent verified reviews per product
  const topReviews = await Review.find({
    productId: { $in: foundProductIds },
  })
    .sort({ helpfulCount: -1, createdAt: -1 })
    .limit(foundProductIds.length * 4)
    .select("productId rating comment verifiedPurchase createdAt userName")
    .lean();

  const reviewsByProduct = new Map<string, typeof topReviews>();
  for (const r of topReviews) {
    const list = reviewsByProduct.get(r.productId) || [];
    if (list.length < 3) {
      list.push(r);
      reviewsByProduct.set(r.productId, list);
    }
  }

  // Fetch active couriers for delivery estimates
  const couriers = await Courier.find({ isActive: true })
    .select("name logo estimatedDays rateStructure")
    .lean();

  const standardCourier = couriers[0] || null;
  const standardFee = standardCourier?.rateStructure?.[0]?.price ?? 60;
  const standardDays = standardCourier?.estimatedDays ?? "2-3 days";

  // Assemble enriched comparison objects
  const enriched = products.map((p) => {
    const pId = String(p._id);
    const store = storeMap.get(p.storeId);
    const rStats = statsMap.get(pId);
    const pReviews = reviewsByProduct.get(pId) || [];

    let specs: Record<string, string> = {};
    if (p.specifications instanceof Map) {
      specs = Object.fromEntries(p.specifications.entries());
    } else if (p.specifications && typeof p.specifications === "object") {
      specs = p.specifications as Record<string, string>;
    }

    const totalRev = rStats?.totalCount || p.ratingCount || 0;
    const ratingAvg = Math.round(((rStats?.avgRating || p.ratingAvg || 4.5) * 10)) / 10;

    return {
      id: pId,
      _id: pId,
      title: p.title,
      description: p.description,
      price: p.price,
      discountPrice: p.discountPrice,
      category: p.category,
      stock: p.stock,
      images: p.images || [],
      imageUrl: (p as any).imageUrl,
      tags: p.tags || [],
      specifications: specs,
      variants: p.variants || [],
      highlights: p.highlights || [],
      packageContents: p.packageContents || [],
      ratingAvg,
      ratingCount: totalRev,
      sold: p.sold || 0,
      freeDelivery: Boolean(p.freeDelivery),
      warrantyMonths: p.warrantyMonths || (specs["Warranty"] ? parseInt(specs["Warranty"], 10) : undefined),
      warrantyProvider: p.warrantyProvider || (store?.storeName ? `${store.storeName} Official` : "Seller Warranty"),
      sentiment: p.sentiment || { positive: 85, neutral: 10, negative: 5 },
      store: store
        ? {
            id: String(store._id),
            storeName: store.storeName,
            slug: store.slug,
            rating: store.rating || 4.8,
            ratingCount: store.ratingCount || 10,
            trustScore: store.trustScore || 85,
            isVerified: Boolean(store.verifiedAt),
            address: store.businessInfo?.businessAddress || store.location?.address || "Dhaka, Bangladesh",
            memberSince: store.createdAt,
          }
        : {
            id: p.storeId,
            storeName: "ShopNest Verified Merchant",
            slug: "shopnest-merchant",
            rating: 4.8,
            ratingCount: 15,
            trustScore: 88,
            isVerified: true,
            address: "Dhaka, Bangladesh",
          },
      reviewsSummary: {
        avgRating: ratingAvg,
        totalReviews: totalRev,
        verifiedPurchases: rStats?.verifiedCount || Math.round(totalRev * 0.8),
        distribution: {
          5: rStats?.stars5 || Math.round(totalRev * 0.7),
          4: rStats?.stars4 || Math.round(totalRev * 0.2),
          3: rStats?.stars3 || Math.round(totalRev * 0.06),
          2: rStats?.stars2 || Math.round(totalRev * 0.03),
          1: rStats?.stars1 || Math.round(totalRev * 0.01),
        },
        sampleReviews: pReviews.map((rev) => ({
          rating: rev.rating,
          comment: rev.comment,
          userName: rev.userName,
          verifiedPurchase: rev.verifiedPurchase,
          createdAt: rev.createdAt,
        })),
      },
      deliverySummary: {
        freeDelivery: Boolean(p.freeDelivery),
        standardFee: p.freeDelivery ? 0 : standardFee,
        estimatedDays: standardDays,
        courierName: standardCourier?.name || "ShopNest Express",
        cashOnDelivery: true,
      },
      returnPolicy: {
        days: 7,
        type: "Free Return & Replacement Guarantee",
        conditions: "Applicable within 7 days in original condition.",
      },
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });

  sendSuccess(res, enriched);
});

export const getRecommendedProducts = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 8));

  if (!id || id === "undefined" || id === "null" || !mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest("Invalid product ID");
  }

  const currentProduct = await Product.findById(id).select("_id category status isDeleted storeSuspended").lean();
  if (!currentProduct) {
    throw ApiError.notFound("Product not found");
  }

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const currentCategory = (currentProduct.category || "").trim();

  // 1. Check for products in the exact same category (excluding current product)
  const sameCategoryFilter = await buildPublicProductFilter({
    category: { $regex: `^${escapeRegex(currentCategory)}$`, $options: "i" },
    _id: { $ne: currentProduct._id },
  });

  let products = await Product.find(sameCategoryFilter)
    .sort({ ratingAvg: -1, sold: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  let source: "same_category" | "parent_category" | "fallback" = "same_category";
  let parentCategoryName: string | undefined = undefined;

  // 2. If no products found in the same category, check the parent category
  if (products.length === 0 && currentCategory) {
    const categoryDoc = await Category.findOne({
      $or: [
        { name: { $regex: `^${escapeRegex(currentCategory)}$`, $options: "i" } },
        { slug: currentCategory.toLowerCase() },
      ],
    })
      .select("_id name parent")
      .lean();

    if (categoryDoc?.parent) {
      const parentDoc = await Category.findById(categoryDoc.parent).select("_id name").lean();
      if (parentDoc) {
        parentCategoryName = parentDoc.name;
        const parentCategoryNames = await resolveCategoryNames(parentDoc.name);
        const parentFilter = await buildPublicProductFilter({
          category: { $in: parentCategoryNames },
          _id: { $ne: currentProduct._id },
        });

        products = await Product.find(parentFilter)
          .sort({ ratingAvg: -1, sold: -1, createdAt: -1 })
          .limit(limit)
          .lean();

        if (products.length > 0) {
          source = "parent_category";
        }
      }
    }
  }

  // 3. Fallback: if still 0 products, return featured / top-selling active products
  if (products.length === 0) {
    const fallbackFilter = await buildPublicProductFilter({
      _id: { $ne: currentProduct._id },
    });

    products = await Product.find(fallbackFilter)
      .sort({ isFeatured: -1, ratingAvg: -1, sold: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (products.length > 0) {
      source = "fallback";
    }
  }

  const normalized = normalizeLeanArray(products as Record<string, unknown>[]);
  sendSuccess(res, {
    products: normalized,
    source,
    category: currentCategory,
    parentCategory: parentCategoryName,
  });
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id || id === "undefined" || id === "null" || !mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest("Invalid product ID");
  }
  const product = await Product.findById(id).lean();
  if (!product) throw ApiError.notFound("Product not found");

  const user = req.user;
  const isOwnerOrAdmin =
    !!user && (user.role === "admin" || String(user.id) === String(product.sellerId));

  if (!isOwnerOrAdmin) {
    if (
      product.isDeleted !== ACTIVE_PRODUCT_FILTER.isDeleted ||
      product.status !== ACTIVE_PRODUCT_FILTER.status
    ) {
      throw ApiError.notFound("Product not found");
    }

    const store = mongoose.isValidObjectId(product.storeId)
      ? await Store.findById(product.storeId).select("status").lean()
      : await resolveStore(product.storeId);

    if (!store || EXCLUDED_STORE_STATUSES.includes(store.status)) {
      throw ApiError.notFound("Product not found");
    }
  }

  sendSuccess(res, normalizeLean(product as Record<string, unknown>));
});

function generateVariantSku(productTitle: string, variantName: string): string {
  const cleanTitle = (productTitle || "PROD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const cleanVar = (variantName || "VAR")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return `${cleanTitle || "PROD"}-${cleanVar || "VAR"}`;
}

function pickProductFields(
  body: Record<string, unknown>,
  isAdmin: boolean
): Partial<IProduct> {
  const allowed: Partial<IProduct> = {};

  if (typeof body.title === "string") allowed.title = body.title.trim();
  if (typeof body.description === "string") allowed.description = body.description.trim();
  if (body.price !== undefined) allowed.price = Number(body.price);
  if (body.discountPrice !== undefined) {
    allowed.discountPrice = body.discountPrice === null ? undefined : Number(body.discountPrice);
  }
  if (typeof body.category === "string") allowed.category = body.category.trim();
  if (body.stock !== undefined) allowed.stock = Number(body.stock);
  if (Array.isArray(body.images)) allowed.images = body.images as string[];
  if (Array.isArray(body.tags)) allowed.tags = body.tags as string[];
  if (body.specifications && typeof body.specifications === "object") {
    const rawSpecs = body.specifications instanceof Map
      ? Object.fromEntries(body.specifications)
      : { ...(body.specifications as Record<string, string>) };
    // Eliminate dual storage: remove Variants from specifications
    delete rawSpecs["Variants"];
    delete rawSpecs["variants"];
    allowed.specifications = rawSpecs as unknown as Map<string, string>;
  }
  if (Array.isArray(body.variants)) {
    const rawVariants = body.variants as IProductVariant[];
    const seenNames = new Set<string>();
    const cleanedVariants: IProductVariant[] = [];

    for (const v of rawVariants) {
      const name = (v.name || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (seenNames.has(lower)) {
        throw ApiError.badRequest(`Duplicate variant name "${name}" is not allowed`);
      }
      seenNames.add(lower);

      const sku = v.sku && v.sku.trim()
        ? v.sku.trim().toUpperCase()
        : generateVariantSku(allowed.title || (typeof body.title === "string" ? body.title : ""), name);

      cleanedVariants.push({
        name,
        sku,
        stock: Math.max(0, Number(v.stock) || 0),
        price: v.price != null && Number(v.price) >= 0 ? Number(v.price) : undefined,
        color: v.color?.trim() || undefined,
      });
    }

    allowed.variants = cleanedVariants;
    if (cleanedVariants.length > 0) {
      allowed.stock = cleanedVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
    }
  }
  if (Array.isArray(body.highlights)) allowed.highlights = body.highlights as IProductHighlight[];
  if (Array.isArray(body.packageContents)) allowed.packageContents = body.packageContents as string[];
  if (typeof body.freeDelivery === "boolean") allowed.freeDelivery = body.freeDelivery;
  if (body.warrantyMonths !== undefined) allowed.warrantyMonths = Number(body.warrantyMonths);
  if (typeof body.warrantyProvider === "string") allowed.warrantyProvider = body.warrantyProvider;
  if (isAdmin && typeof body.isFeatured === "boolean") allowed.isFeatured = body.isFeatured;

  return allowed;
}

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user?.role === "admin";
  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before adding products. Please complete your store setup first.");
  }
  if (!isAdmin && (store.status === "suspended" || store.status === "rejected")) {
    throw ApiError.forbidden("Your store is currently suspended. Listing new products is restricted while under review.");
  }

  const data = pickProductFields(req.body, isAdmin);

  const product = await Product.create({
    ...data,
    storeId: store._id.toString(),
    sellerId: userId,
    status: "approved",
  });

  sendSuccess(res, product.toJSON(), "Product created", 201);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  const isAdmin = req.user!.role === "admin";
  const isOwner = product.sellerId === userId;

  if (!isAdmin && !isOwner) {
    throw ApiError.forbidden("You do not have permission to update this product");
  }

  let storeUpdates: Record<string, unknown> = {};
  if (!isAdmin) {
    const store = await getSellerStore(userId);
    if (!store) {
      throw ApiError.badRequest("You must create a store before updating products. Please complete your store setup first.");
    }
    if (store.status === "suspended") {
      throw ApiError.forbidden("Your store is currently suspended. Editing product listings is restricted while under review.");
    }
    storeUpdates = { storeId: store._id.toString(), sellerId: userId };
  }

  const updateData = pickProductFields(req.body, isAdmin);

  Object.assign(product, updateData, storeUpdates);
  await product.save();
  clearListCache();

  sendSuccess(res, product.toJSON(), "Product updated");
});

export const updateFeaturedProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id || id === "undefined" || id === "null" || !mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest("Invalid product ID");
  }

  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound("Product not found");

  const { isFeatured } = req.body as { isFeatured?: boolean };
  if (typeof isFeatured !== "boolean") {
    throw ApiError.badRequest("isFeatured boolean field is required");
  }

  product.isFeatured = isFeatured;
  await product.save();

  clearListCache();

  sendSuccess(res, product.toJSON(), `Product marked as ${isFeatured ? "featured" : "standard"}`);
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  const isAdmin = req.user!.role === "admin";
  const isOwner = product.sellerId === userId;

  if (!isAdmin && !isOwner) {
    throw ApiError.forbidden("You do not have permission to delete this product");
  }

  if (!isAdmin) {
    const store = await getSellerStore(userId);
    if (store && store.status === "suspended") {
      throw ApiError.forbidden("Your store is currently suspended. Deleting product listings is restricted while under review.");
    }
  }

  product.isDeleted = true;
  product.status = "rejected";
  await product.save();
  clearListCache();

  sendSuccess(res, { success: true }, "Product deleted");
});

export const moderateProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  const { status } = req.body as { status?: "pending" | "approved" | "rejected" };

  if (status) {
    product.status = status;
  }

  await product.save();
  clearListCache();

  sendSuccess(res, product.toJSON(), `Product ${status || "updated"} by admin`);
});

