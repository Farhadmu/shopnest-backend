import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Product, IProduct } from "./product.model";
import { Store } from "../sellers/store.model";
import { Category } from "../categories/category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** Resolves a category name to itself plus the names of every descendant
 * category, so filtering by a parent (e.g. "Electronics") also returns
 * products filed under its subcategories (e.g. "Phones", "Laptops").
 * Falls back to just the given name if it isn't a known category. */
async function resolveCategoryNames(categoryName: string): Promise<string[]> {
  const root = await Category.findOne({
    $or: [
      { name: { $regex: `^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { slug: categoryName.toLowerCase() },
    ],
  })
    .select("_id name")
    .lean();
  if (!root) return [categoryName];

  const allCategories = await Category.find().select("_id name parent").lean();
  const byParent = new Map<string, { _id: unknown; name: string }[]>();
  allCategories.forEach((c) => {
    const parentId = c.parent ? String(c.parent) : "";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(c);
  });

  const names = [root.name];
  const queue = [String(root._id)];
  while (queue.length) {
    const id = queue.shift()!;
    const children = byParent.get(id) || [];
    for (const child of children) {
      names.push(child.name);
      queue.push(String(child._id));
    }
  }
  return names;
}

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
  
  if (category) {
    const names = await resolveCategoryNames(category);
    const regexes = names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
    filter.category = regexes.length > 1 ? { $in: regexes } : regexes[0];
  }

  if (storeId) filter.storeId = storeId;
  
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = minPrice;
    if (maxPrice) filter.price.$lte = maxPrice;
  }

 
  if (search) {
    filter.$or = [
      { $text: { $search: search } }, 
      { category: { $regex: search, $options: "i" } }, 
    ];
  }

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
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Limit");
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
  let store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) {
    const rawName = req.user!.name || "Seller";
    const slugBase = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const uniqueSlug = `${slugBase || "store"}-${req.user!.id.slice(-4)}`;
    store = await Store.create({
      ownerId: req.user!.id,
      storeName: `${rawName}'s Store`,
      slug: uniqueSlug,
      description: `Welcome to ${rawName}'s official store on ShopNest.`,
      status: "approved",
      trustScore: 85,
    });
  }

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