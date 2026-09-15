import { Request, Response } from "express";
import mongoose from "mongoose";
import { Product, IProduct } from "./product.model";
import { Store } from "../sellers/store.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { ACTIVE_PRODUCT_FILTER, getExcludedStoreIds, EXCLUDED_STORE_STATUSES } from "../../utils/activeProductFilter";
import { getSellerStore } from "../sellers/seller-store.util";
import { resolveCategoryNames } from "../../utils/category.utils";
import { normalizeLeanArray, normalizeLean } from "../../utils/model-plugins";

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

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 12));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { ...ACTIVE_PRODUCT_FILTER };

  if (query.search) {
    filter.$text = { $search: query.search };
  }
  if (query.category) {
    const names = await resolveCategoryNames(query.category);
    filter.category = { $in: names };
  }
  if (query.storeId) {
    filter.storeId = query.storeId;
  }
  if (query.store) {
    const store = await resolveStore(query.store);
    if (store) {
      filter.storeId = store._id.toString();
    } else {
      filter.storeId = null;
    }
  }
  if (query.sellerId) {
    filter.sellerId = query.sellerId;
  }
  if (query.seller) {
    const store = await resolveStore(query.seller);
    if (store) {
      filter.$or = [
        { sellerId: store.ownerId },
        { storeId: store._id.toString() },
      ];
    } else {
      filter.sellerId = null;
    }
  }
  if (query.rating) {
    filter.ratingAvg = { $gte: Number(query.rating) };
  }
  if (query.productRating) {
    filter.ratingAvg = { $gte: Number(query.productRating) };
  }
  if (query.verified === "true") {
    filter.freeDelivery = true;
  }
  if (query.inStock === "true") {
    filter.stock = { $gt: 0 };
  }
  if (query.freeDelivery === "true") {
    filter.freeDelivery = true;
  }
  if (query.aiPick === "true") {
    filter.aiPick = true;
  }
  if (query.minPrice !== undefined) {
    filter.price = { ...(filter.price as Record<string, unknown> || {}), $gte: Number(query.minPrice) };
  }
  if (query.maxPrice !== undefined) {
    filter.price = { ...(filter.price as Record<string, unknown> || {}), $lte: Number(query.maxPrice) };
  }
  if (query.status && query.status !== "approved") {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
      { status: query.status },
    ];
  }

  const excludedStoreIds = await getExcludedStoreIds();
  if (excludedStoreIds.length) {
    if (filter.storeId === undefined) {
      filter.storeId = { $nin: excludedStoreIds };
    } else {
      filter.$and = [
        { storeId: filter.storeId },
        { storeId: { $nin: excludedStoreIds } },
        ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
      ];
      delete filter.storeId;
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
    case "newest":
    default:
      sortOption = { createdAt: -1 };
      break;
  }

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sortOption).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);

  res.set("X-Total-Count", String(total));
  res.set("X-Page", String(page));
  res.set("X-Limit", String(limit));

  sendSuccess(res, normalizeLeanArray(products as Record<string, unknown>[]));
});

export const getStoreOptions = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await Store.find({ status: "approved" })
    .select("_id storeName slug rating trustScore")
    .lean();

  const options = await Promise.all(
    stores.map(async (store) => {
      const count = await Product.countDocuments({
        storeId: store._id.toString(),
        ...ACTIVE_PRODUCT_FILTER,
      });
      return {
        id: store._id.toString(),
        name: store.storeName,
        rating: store.rating,
        productCount: count,
      };
    })
  );

  sendSuccess(res, options);
});

export const getSellerOptions = asyncHandler(async (_req: Request, res: Response) => {
  const stores = await Store.find({ status: "approved" })
    .select("_id storeName slug ownerId rating trustScore")
    .lean();

  const options = await Promise.all(
    stores.map(async (store) => {
      const count = await Product.countDocuments({
        $or: [{ storeId: store._id.toString() }, { sellerId: store.ownerId }],
        ...ACTIVE_PRODUCT_FILTER,
      });
      return {
        id: store._id.toString(),
        name: store.storeName,
        rating: store.rating,
        productCount: count,
      };
    })
  );

  sendSuccess(res, options);
});

export const listMyProducts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const store = await getSellerStore(userId);
  const storeIdStr = store._id.toString();

  const products = await Product.find({
    $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store._id }],
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, normalizeLeanArray(products as Record<string, unknown>[]));
});

export const getTrendingProducts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));

  const excludedStoreIds = await getExcludedStoreIds();

  const products = await Product.find({
    ...ACTIVE_PRODUCT_FILTER,
    ...(excludedStoreIds.length ? { storeId: { $nin: excludedStoreIds } } : {}),
    stock: { $gt: 0 },
  })
    .sort({ sold: -1, ratingAvg: -1 })
    .limit(limit)
    .lean();

  const normalized = normalizeLeanArray(products as Record<string, unknown>[]);
  sendSuccess(res, { count: normalized.length, products: normalized });
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

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before adding products. Please complete your store setup first.");
  }

  const data = req.body as Partial<IProduct>;

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

  const store = await getSellerStore(userId);
  if (!store) {
    throw ApiError.badRequest("You must create a store before updating products. Please complete your store setup first.");
  }
  Object.assign(product, req.body, { storeId: store._id.toString(), sellerId: userId });
  await product.save();

  sendSuccess(res, product.toJSON(), "Product updated");
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

  sendSuccess(res, product.toJSON(), `Product ${status || "updated"} by admin`);
});
