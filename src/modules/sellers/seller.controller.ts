import { Request, Response } from "express";
import mongoose from "mongoose";
import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Promotes the authenticated customer to a seller and creates their store. */
export const registerStore = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Store.findOne({ ownerId: req.user!.id });
  if (existing) throw ApiError.conflict("You already have a store");

  const { storeName, description, logo, banner, businessInfo } = req.body;
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

  // Best-effort: flip the user's role to "seller" directly in better-auth's
  // `user` collection, since this backend does not own the identity store.
  try {
    const db = mongoose.connection.db;
    if (db) {
      await db.collection("user").updateOne(
        { $or: [{ id: req.user!.id }, { _id: safeObjectId(req.user!.id) }] },
        { $set: { role: "seller" } }
      );
    }
  } catch (err) {
    logger.warn("Could not sync role=seller back to better-auth user collection", err);
  }

  sendSuccess(res, store.toJSON(), "Store created, pending admin approval", 201);
});

function safeObjectId(id: string) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return new mongoose.Types.ObjectId();
  }
}

export const getMyStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.notFound("You do not have a store yet");
  sendSuccess(res, store.toJSON());
});

export const updateMyStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOneAndUpdate({ ownerId: req.user!.id }, req.body, { new: true });
  if (!store) throw ApiError.notFound("You do not have a store yet");
  sendSuccess(res, store.toJSON(), "Store updated");
});

/** Public store page: GET /sellers/stores/:storeId */
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

/** GET /sellers/metrics - dashboard summary for the authenticated seller */
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

export const listStores = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as { status?: string };
  const filter = status ? { status } : {};
  const stores = await Store.find(filter).sort({ createdAt: -1 });
  res.status(200).json(stores);
});
