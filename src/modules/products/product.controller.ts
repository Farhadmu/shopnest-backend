import { Request, Response } from "express";
import mongoose from "mongoose";
import { Product, IProduct, IProductVariant, IProductHighlight } from "./product.model";
import { Store } from "../sellers/store.model";
import { Category } from "../categories/category.model";
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
  if (query.seller) return false;
  if (query.store) return false;
  if (query.minPrice !== undefined || query.maxPrice !== undefined) return false;
  if (query.rating || query.productRating) return false;
  if (query.verified === "true" || query.verified === "1" || query.inStock === "true" || query.inStock === "1" || query.aiPick === "true" || query.aiPick === "1" || query.freeDelivery === "true" || query.freeDelivery === "1") return false;
  if (query.status && query.status !== "approved") return false;
  if (query.isFeatured !== undefined) return false;
  if (query.sort === "featured") return false;
  return true;
}

function buildListCacheKey(filter: Record<string, unknown>, sortOption: Record<string, 1 | -1>, page: number, limit: number): string {
  return JSON.stringify({ f: filter, s: sortOption, p: page, l: limit });
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
  if (query.sellerId) {
    baseFilter.sellerId = query.sellerId;
  }
  if (query.seller) {
    const store = await resolveStore(query.seller);
    if (store) {
      baseFilter.$or = [
        { sellerId: store.ownerId },
        { storeId: store._id.toString() },
      ];
    } else {
      baseFilter.sellerId = null;
    }
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

  if (query.category) {
    const names = await resolveCategoryNames(query.category);
    filter.category = { $in: names };
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
    const cacheKey = buildListCacheKey(filter, sortOption, page, limit);
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
    setListCache(buildListCacheKey(filter, sortOption, page, limit), {
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
    allowed.specifications = body.specifications as Map<string, string>;
  }
  if (Array.isArray(body.variants)) allowed.variants = body.variants as IProductVariant[];
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
  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before adding products. Please complete your store setup first.");
  }

  const isAdmin = req.user?.role === "admin";
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

