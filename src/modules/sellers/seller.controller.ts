import { Request, Response } from "express";
import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

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
      return sendSuccess(res, existing.toJSON(), "Application resubmitted, pending admin approval", 200);
    }
    throw ApiError.conflict("You already have a store");
  }

  let slug = slugify(storeName);
  const dup = await Store.findOne({ slug });
  if (dup) slug = `${slug}-${Date.now().toString(36)}`;

  const store = await Store.create({
    ownerId: req.user!.id,
    storeName,
    slug,
    description,
    logo,
    banner,
    businessInfo,
    status: "pending",
  });

  sendSuccess(res, store.toJSON(), "Store created, pending admin approval", 201);
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
  const store = await Store.findById(req.params.storeId);
  if (!store || store.status === "rejected") throw ApiError.notFound("Store not found");

  sendSuccess(res, {
    id: store.id,
    storeName: store.storeName,
    description: store.description,
    trustScore: store.trustScore,
    logo: store.logo,
    banner: store.banner,
    rating: store.rating,
    ratingCount: store.ratingCount,
    followersCount: store.followersCount,
    status: store.status,
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
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) {
    return sendSuccess(res, { totalSales: 0, totalOrders: 0, totalProducts: 0 });
  }

  const [totalProducts, orderAgg] = await Promise.all([
    Product.countDocuments({ storeId: store.id, isDeleted: false }),
    Order.aggregate([
      { $unwind: "$items" },
      { $match: { "items.storeId": store.id } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          totalOrders: { $addToSet: "$_id" },
        },
      },
    ]),
  ]);

  const totalSales = orderAgg[0]?.totalSales ?? 0;
  const totalOrders = orderAgg[0]?.totalOrders?.length ?? 0;

  sendSuccess(res, { totalSales, totalOrders, totalProducts });
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
  const { status } = req.query as { status?: string };
  const filter = status ? { status } : {};
  const stores = await Store.find(filter).sort({ createdAt: -1 });
  res.status(200).json(stores);
});
