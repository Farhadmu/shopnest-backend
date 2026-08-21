import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Product, IProduct } from "./product.model";
import { Store } from "../sellers/store.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** GET /products - public catalog, filterable + paginated. Returns a raw array to match the frontend's Product[] contract, with pagination metadata in headers. */
export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, category, storeId, minPrice, maxPrice, sort, status } = req.query as unknown as {
    page: number;
    limit: number;
    search?: string;
    category?: string;
    storeId?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    status?: string;
  };

  const filter: FilterQuery<IProduct> = { isDeleted: false };
  // Public callers only ever see approved products; admins/sellers may filter by status.
  filter.status = req.user?.role === "admin" || req.user?.role === "seller" ? status ?? "approved" : "approved";
  if (category) filter.category = category;
  if (storeId) filter.storeId = storeId;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = minPrice;
    if (maxPrice) filter.price.$lte = maxPrice;
  }
  if (search) filter.$text = { $search: search };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating: { ratingAvg: -1 },
    popular: { sold: -1 },
  };
  const sortStage = sortMap[sort ?? "newest"] ?? sortMap.newest;

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort(sortStage)
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Limit", String(limit));
  res.status(200).json(items);
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  if (product.status !== "approved" && req.user?.role !== "admin" && req.user?.id !== product.sellerId) {
    throw ApiError.notFound("Product not found");
  }

  Product.findByIdAndUpdate(product.id, { $inc: { views: 1 } }).catch(() => undefined);

  sendSuccess(res, product.toJSON());
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.forbidden("You must register a store before adding products");
  if (store.status === "suspended" || store.status === "rejected") {
    throw ApiError.forbidden(`Your store is ${store.status} and cannot list products`);
  }

  const product = await Product.create({
    ...req.body,
    storeId: store.id,
    sellerId: req.user!.id,
    status: "approved",
  });

  sendSuccess(res, product.toJSON(), "Product created", 201);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  if (req.user!.role !== "admin" && product.sellerId !== req.user!.id) {
    throw ApiError.forbidden("You do not own this product");
  }

  Object.assign(product, req.body);
  await product.save();

  sendSuccess(res, product.toJSON(), "Product updated");
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  if (req.user!.role !== "admin" && product.sellerId !== req.user!.id) {
    throw ApiError.forbidden("You do not own this product");
  }

  product.isDeleted = true;
  await product.save();

  sendSuccess(res, { success: true }, "Product deleted");
});

export const moderateProduct = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: "pending" | "approved" | "rejected" };
  const product = await Product.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!product) throw ApiError.notFound("Product not found");
  sendSuccess(res, product.toJSON(), `Product ${status}`);
});
