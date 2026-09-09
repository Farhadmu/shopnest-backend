import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Product, IProduct } from "./product.model";
import { Store } from "../sellers/store.model";
import { Category } from "../categories/category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Helper: Resolves a category name to itself plus all subcategory names.
 * For example, filtering by "Electronics" will also match "Phones" and "Laptops".
 */
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

/**
 * Controller: List Products (Public Catalog & Search)
 *
 * 1. Inputs Extracted:
 *    - req.query: page, limit, search, category, storeId, store, rating, minPrice, maxPrice, sort, status
 *    - store / storeId: comma-separated store slugs or IDs
 *    - rating: minimum merchant rating (0–5)
 *    - req.user: attached if user is logged in (used for role-based status filtering)
 * 2. Database Operation:
 *    - Resolves store slugs/IDs to internal store _ids
 *    - Optionally intersects with stores meeting the minimum rating
 *    - Product.find(filter).sort(...).skip(...).limit(...)
 *    - Product.countDocuments(filter)
 * 3. Response Sent:
 *    - HTTP 200: Raw array of product objects (Product[]) to match frontend contract
 *    - Pagination headers: X-Total-Count, X-Page, X-Limit
 */
export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 12,
    search,
    category,
    storeId,
    store,
    sellerId,
    seller,
    minPrice,
    maxPrice,
    sort,
    status,
    productRating,
    verified,
    inStock,
    freeDelivery,
    aiPick,
  } = req.query as unknown as {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    storeId?: string;
    store?: string;
    sellerId?: string;
    seller?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    status?: string;
    productRating?: string;
    verified?: string;
    inStock?: string;
    freeDelivery?: string;
    aiPick?: string;
  };

  const filter: FilterQuery<IProduct> = { isDeleted: false };

  // Public visitors see approved products; admins & sellers can filter by status
  filter.status = req.user?.role === "admin" || req.user?.role === "seller" ? status ?? "approved" : "approved";

  // Category filter with subcategory expansion
  if (category) {
    const names = await resolveCategoryNames(category);
    const regexes = names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
    filter.category = regexes.length > 1 ? { $in: regexes } : regexes[0];
  }

  // Resolve store filters (supports comma-separated slugs or ObjectId strings)
  const rawStoreParam = [storeId, store].filter(Boolean).join(",").trim();
  const ratingParam = req.query.rating as string | undefined;
  const verifiedParam = req.query.verified as string | undefined;

  if (rawStoreParam || ratingParam || verifiedParam) {
    let matchingStoreIds: string[] = [];

    if (rawStoreParam) {
      const ids = rawStoreParam.split(",").map((s) => s.trim()).filter(Boolean);
      const matchedStores = await Store.find({
        $or: [
          { _id: { $in: ids } },
          { slug: { $in: ids } },
        ],
        status: "approved",
      }).select("_id");
      matchingStoreIds = matchedStores.map((s) => String(s._id));
    }

    if (ratingParam) {
      const minRating = Number(ratingParam);
      const ratedStores = await Store.find({
        status: "approved",
        rating: { $gte: minRating },
      }).select("_id");
      const ratedIds = ratedStores.map((s) => String(s._id));

      if (matchingStoreIds.length > 0) {
        matchingStoreIds = matchingStoreIds.filter((id) => ratedIds.includes(id));
      } else {
        matchingStoreIds = ratedIds;
      }
    }

    if (verifiedParam === "1") {
      const verifiedStores = await Store.find({
        status: "approved",
        verifiedAt: { $exists: true, $ne: null },
      }).select("_id");
      const verifiedIds = verifiedStores.map((s) => String(s._id));

      if (matchingStoreIds.length > 0) {
        matchingStoreIds = matchingStoreIds.filter((id) => verifiedIds.includes(id));
      } else {
        matchingStoreIds = verifiedIds;
      }
    }

    if (matchingStoreIds.length > 0) {
      filter.storeId = { $in: matchingStoreIds };
    } else {
      filter.storeId = { $in: [] };
    }
  }

  // Resolve seller filters (supports comma-separated seller user IDs or names)
  const rawSellerParam = [sellerId, seller].filter(Boolean).join(",").trim();
  if (rawSellerParam) {
    const sellerValues = rawSellerParam.split(",").map((s) => s.trim()).filter(Boolean);
    const matchedSellers = await Store.find({
      $or: [
        { ownerId: { $in: sellerValues } },
        { storeName: { $in: sellerValues } },
      ],
      status: "approved",
    }).select("ownerId");
    const matchedSellerIds = matchedSellers.map((s) => s.ownerId);

    if (matchedSellerIds.length > 0) {
      filter.sellerId = { $in: matchedSellerIds };
    } else {
      filter.sellerId = { $in: [] };
    }
  }

  if (productRating) {
    filter.ratingAvg = { $gte: Number(productRating) };
  }

  if (inStock === "1") {
    filter.stock = { $gt: 0 };
  }

  if (freeDelivery === "1") {
    filter.freeDelivery = true;
  }

  if (aiPick === "1") {
    filter.aiPick = true;
  }

  // Price range filters
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = minPrice;
    if (maxPrice) filter.price.$lte = maxPrice;
  }

  // Text search query
  if (search) {
    filter.$or = [
      { $text: { $search: search } },
      { category: { $regex: search, $options: "i" } },
    ];
  }

  // Sorting options
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating: { ratingAvg: -1 },
    popular: { sold: -1 },
  };
  const sortStage = sortMap[sort ?? "newest"] ?? sortMap.newest;

  // Execute database query and document count in parallel
  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort(sortStage)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit)),
    Product.countDocuments(filter),
  ]);

  // Set pagination headers expected by frontend
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Limit", String(limit));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Limit");

  res.status(200).json(items);
});

/**
 * Controller: Get Store Options for "Shop by Store" Filter
 *
 * Returns approved stores that have at least one approved product, with
 * their slug, name, rounded rating, and product count.
 *
 * 1. Database Operation:
 *    - Store aggregation with $lookup to count approved products per store
 * 2. Response Sent:
 *    - HTTP 200: Array of { id, name, rating, productCount }
 */
export const getStoreOptions = asyncHandler(async (req: Request, res: Response) => {
  const stores = await Store.aggregate([
    { $match: { status: "approved" } },
    {
      $lookup: {
        from: "products",
        let: { sid: { $toString: "$_id" } },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$storeId", "$$sid"] },
                  { $eq: ["$status", "approved"] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
          { $count: "cnt" },
        ],
        as: "counts",
      },
    },
    {
      $addFields: {
        productCount: { $ifNull: [{ $arrayElemAt: ["$counts.cnt", 0] }, 0] },
      },
    },
    {
      $project: {
        _id: 0,
        id: "$slug",
        name: "$storeName",
        rating: { $round: ["$rating", 1] },
        productCount: 1,
      },
    },
    { $match: { productCount: { $gt: 0 } } },
    { $sort: { name: 1 } },
  ]);

  res.status(200).json(stores);
});

export const getSellerOptions = asyncHandler(async (req: Request, res: Response) => {
  const sellers = await Store.aggregate([
    { $match: { status: "approved" } },
    {
      $lookup: {
        from: "products",
        let: { sid: { $toString: "$_id" }, oid: "$ownerId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$sellerId", "$$oid"] },
                  { $eq: ["$status", "approved"] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
          { $count: "cnt" },
        ],
        as: "counts",
      },
    },
    {
      $addFields: {
        productCount: { $ifNull: [{ $arrayElemAt: ["$counts.cnt", 0] }, 0] },
      },
    },
    {
      $project: {
        _id: 0,
        id: "$ownerId",
        name: "$storeName",
        rating: { $round: ["$rating", 1] },
        productCount: 1,
      },
    },
    { $match: { productCount: { $gt: 0 } } },
    { $sort: { name: 1 } },
  ]);

  res.status(200).json(sellers);
});

/**
 * Controller: Get Single Product By ID
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Target product ID
 *    - req.user: Logged-in user information (optional)
 * 2. Database Operation:
 *    - Product.findOne({ _id: id, isDeleted: false })
 *    - Increments views counter in the background
 * 3. Response Sent:
 *    - HTTP 200: Single Product JSON object
 */
export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  // Non-admins and non-owners cannot view unapproved products
  if (product.status !== "approved" && req.user?.role !== "admin" && req.user?.id !== product.sellerId) {
    throw ApiError.notFound("Product not found");
  }

  // Increment view counter without blocking the response
  Product.findByIdAndUpdate(product.id, { $inc: { views: 1 } }).catch(() => undefined);

  sendSuccess(res, product.toJSON());
});

/**
 * Controller: Create New Product (Sellers & Admins)
 *
 * 1. Inputs Extracted:
 *    - req.body: title, description, price, discountPrice, category, stock, images, specifications, tags
 *    - req.user: Authenticated seller/admin user (provides owner ID)
 * 2. Database Operation:
 *    - Store.findOne({ ownerId }) to verify active store or auto-create one
 *    - Product.create(...) to save the new product
 * 3. Response Sent:
 *    - HTTP 201: Created product object with success message
 */
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

  const productData = { ...req.body };

  // Sanitize discount price: must be positive and less than the original price
  if (productData.discountPrice !== undefined && (productData.discountPrice <= 0 || productData.discountPrice >= productData.price)) {
    delete productData.discountPrice;
  }

  // Format specifications dictionary
  if (productData.specifications && typeof productData.specifications === "object") {
    const stringSpecs: Record<string, string> = {};
    for (const [key, val] of Object.entries(productData.specifications)) {
      stringSpecs[key] = typeof val === "string" ? val : JSON.stringify(val);
    }
    productData.specifications = stringSpecs;
  }

  const product = await Product.create({
    ...productData,
    storeId: store.id || String(store._id),
    sellerId: req.user!.id,
    status: "approved",
  });

  sendSuccess(res, product.toJSON(), "Product created", 201);
});

/**
 * Controller: Update Product
 *
 * 1. Inputs Extracted:
 *    - req.params.id: ID of the product to update
 *    - req.body: Updated product fields (title, price, stock, images, etc.)
 *    - req.user: Authenticated user (checks ownership or admin role)
 * 2. Database Operation:
 *    - Product.findOne({ _id: id, isDeleted: false })
 *    - product.save()
 * 3. Response Sent:
 *    - HTTP 200: Updated product object with success message
 */
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

/**
 * Controller: Soft Delete Product
 *
 * 1. Inputs Extracted:
 *    - req.params.id: ID of the product to delete
 *    - req.user: Authenticated user (checks ownership or admin role)
 * 2. Database Operation:
 *    - Product.findOne({ _id: id, isDeleted: false })
 *    - product.isDeleted = true; product.save()
 * 3. Response Sent:
 *    - HTTP 200: { success: true } with "Product deleted" message
 */
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

/**
 * Controller: Moderate Product (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: ID of the product to moderate
 *    - req.body.status: New moderation status ("pending" | "approved" | "rejected")
 * 2. Database Operation:
 *    - Product.findByIdAndUpdate(id, { status }, { new: true })
 * 3. Response Sent:
 *    - HTTP 200: Updated product object with status message
 */
export const moderateProduct = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: "pending" | "approved" | "rejected" };
  const product = await Product.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!product) throw ApiError.notFound("Product not found");
  sendSuccess(res, product.toJSON(), `Product ${status}`);
});