import { Request, Response } from "express";
import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Review } from "../reviews/review.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { getSellerContext } from "./seller-store.util";
import mongoose from "mongoose";

/**
 * Helper: Converts any string into a URL-friendly slug.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Public-safe shape of a Store document.
 */
export interface PublicStore {
  id: string;
  slug: string;
  storeName: string;
  description: string;
  logo?: string;
  banner?: string;
  trustScore: number;
  rating: number;
  ratingCount: number;
  followersCount: number;
  status: string;
  createdAt: Date;
}

/**
 * Masks sensitive businessInfo fields before sending in API responses.
 * - payoutAccountNumber -> only last 4 chars (e.g. "••••1234")
 * - nidOrTradeLicense and taxId are omitted entirely
 * Does NOT mutate the source object.
 */
function maskBusinessInfo<T extends { businessInfo?: Record<string, unknown> }>(store: T): T {
  if (!store.businessInfo) return store;
  const bi = { ...store.businessInfo };
  if (typeof bi.payoutAccountNumber === "string" && bi.payoutAccountNumber.length > 4) {
    bi.payoutAccountNumber = "••••" + bi.payoutAccountNumber.slice(-4);
  }
  delete bi.nidOrTradeLicense;
  delete bi.taxId;
  return { ...store, businessInfo: bi };
}

/**
 * Helper: Strips a raw Store document (or lean object) down to its
 * public-safe shape. Excludes ownerId, businessInfo, rejectionReason,
 * verifiedAt, and verifiedBy.
 */
function toPublicStore(
  store: {
    _id: { toString(): string };
    slug: string;
    storeName: string;
    description: string;
    logo?: string;
    banner?: string;
    trustScore: number;
    rating: number;
    ratingCount: number;
    followersCount: number;
    status: string;
    createdAt: Date;
  },
): PublicStore {
  return {
    id: store._id.toString(),
    slug: store.slug,
    storeName: store.storeName,
    description: store.description,
    logo: store.logo,
    banner: store.banner,
    trustScore: store.trustScore,
    rating: store.rating,
    ratingCount: store.ratingCount,
    followersCount: store.followersCount,
    status: store.status,
    createdAt: store.createdAt,
  };
}

/**
 * Controller: Register Store (Seller Application / Re-submission)
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID (owner)
 *    - req.body: storeName, description, logo, banner, businessInfo
 * 2. Database Operation:
 *    - Store.findOne({ ownerId }) to check if store already exists or was rejected
 *    - Store.create(...) to register new store application
 * 3. Response Sent:
 *    - HTTP 201 (or 200 on resubmit): Created/updated store JSON object
 */
export const registerStore = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Store.findOne({ ownerId: req.user!.id });
  const { storeName, description, logo, banner, businessInfo } = req.body;

  if (existing) {
    if (existing.status === "rejected") {
      existing.storeName = storeName || existing.storeName;
      existing.description = description || existing.description;
      if (logo !== undefined) existing.logo = logo;
      if (banner !== undefined) existing.banner = banner;
      if (businessInfo) existing.businessInfo = { ...(existing.businessInfo || {}), ...businessInfo };
      existing.status = "pending";
      existing.rejectionReason = undefined;
      await existing.save();
      return sendSuccess(res, maskBusinessInfo(existing.toJSON()), "Application resubmitted, pending admin approval", 200);
    }
    throw ApiError.conflict("You already have a store");
  }

  let slug = slugify(storeName);
  const dup = await Store.findOne({ slug });
  if (dup) slug = `${slug}-${Date.now().toString(36)}`;

  let store;
  try {
    store = await Store.create({
      ownerId: req.user!.id,
      storeName,
      slug,
      description,
      logo,
      banner,
      businessInfo,
      status: "pending",
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 11000
    ) {
      throw ApiError.conflict("You already have a store");
    }
    throw err;
  }

  sendSuccess(res, maskBusinessInfo(store.toJSON()), "Store created, pending admin approval", 201);
});

/**
 * Controller: Get Logged-In User's Store
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated seller ID
 * 2. Database Operation:
 *    - Store.findOne({ ownerId })
 * 3. Response Sent:
 *    - HTTP 200: Store JSON object (or 404 if not registered yet)
 */
export const getMyStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.notFound("You do not have a store yet");
  sendSuccess(res, store.toJSON());
});

/**
 * Controller: Update Logged-In User's Store
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated seller ID
 *    - req.body: storeName, description, logo, banner, businessInfo, resubmit
 * 2. Database Operation:
 *    - Store.findOne({ ownerId }), updates properties, store.save()
 * 3. Response Sent:
 *    - HTTP 200: Updated Store JSON object with "Store updated" message
 */
export const updateMyStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.notFound("You do not have a store yet");

  const { storeName, description, logo, banner, businessInfo, resubmit } = req.body;
  if (storeName) store.storeName = storeName;
  if (description) store.description = description;
  if (logo !== undefined) store.logo = logo;
  if (banner !== undefined) store.banner = banner;
  if (businessInfo) {
    store.businessInfo = {
      ...(store.businessInfo || {}),
      ...businessInfo,
    };
  }
  if (resubmit && (store.status === "rejected" || store.status === "pending")) {
    store.status = "pending";
    store.rejectionReason = undefined;
  }

  await store.save();
  sendSuccess(res, store.toJSON(), "Store updated");
});

/**
 * Controller: Get Public Store Details By ID
 *
 * 1. Inputs Extracted:
 *    - req.params.storeId: Store ID
 * 2. Database Operation:
 *    - Store.findById(storeId)
 * 3. Response Sent:
 *    - HTTP 200: Public storefront profile { id, storeName, description, trustScore, logo, banner, rating, ... }
 */
export const getStoreById = asyncHandler(async (req: Request, res: Response) => {
  const identifier = req.params.storeId;
  const store = await Store.findOne({
    $or: [
      { slug: identifier.toLowerCase() },
      ...(mongoose.isValidObjectId(identifier) ? [{ _id: identifier }] : []),
    ],
  }).lean();
  if (!store || store.status === "rejected") throw ApiError.notFound("Store not found");

  const products = await Product.find({
    storeId: { $in: [store._id.toString(), store.slug, store.ownerId] },
    status: "approved",
    isDeleted: false,
  })
    .sort({ sold: -1, createdAt: -1 })
    .lean();

  const reviews = products.length
    ? await Review.find({ productId: { $in: products.map((product) => product._id.toString()) } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    : [];

  sendSuccess(res, {
    ...toPublicStore(store),
    ownerId: store.ownerId,
    products,
    reviews: reviews.map((review) => ({
      ...review,
      productId: review.productId,
    })),
  });
});

/**
 * Controller: Get Seller Dashboard Metrics
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated seller ID
 * 2. Database Operation:
 *    - Store.findOne({ ownerId })
 *    - Product.countDocuments({ storeId, isDeleted: false })
 *    - Order.aggregate(...) to compute total revenue and total orders for this store
 * 3. Response Sent:
 *    - HTTP 200: { totalSales, totalOrders, totalProducts }
 */
export const getSellerMetrics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { products, totalRevenue, totalOrders } = await getSellerContext(userId);
  sendSuccess(res, {
    totalSales: totalRevenue,
    totalOrders,
    totalProducts: products.length,
  });
});

/**
 * Controller: List All Stores (Public / Admin Filterable)
 *
 * 1. Inputs Extracted:
 *    - req.query.status: Optional store status filter
 * 2. Database Operation:
 *    - Store.find(filter).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of Store documents (Store[])
 */
export const listStores = asyncHandler(async (req: Request, res: Response) => {
  const filter = { status: "approved" as const };
  const stores = await Store.find(filter).sort({ createdAt: -1 }).lean();
  const storeIds = stores.flatMap((store) => [
    store._id.toString(),
    store.slug,
    store.ownerId,
  ]);

  const products = await Product.find({
    storeId: { $in: storeIds },
    status: "approved",
    isDeleted: false,
  })
    .sort({ sold: -1, createdAt: -1 })
    .lean();

  const productsByStore = new Map<string, typeof products>();
  for (const product of products) {
    const storeProducts = productsByStore.get(product.storeId) || [];
    storeProducts.push(product);
    productsByStore.set(product.storeId, storeProducts);
  }

  res.status(200).json(
    stores.map((store) => {
      const storeProducts =
        productsByStore.get(store._id.toString()) ||
        productsByStore.get(store.slug) ||
        productsByStore.get(store.ownerId) ||
        [];
      const salesNumber = storeProducts.reduce((total, product) => total + (product.sold || 0), 0);

      return {
        ...toPublicStore(store),
        products: storeProducts.slice(0, 3),
        salesNumber,
      };
    }),
  );
});
