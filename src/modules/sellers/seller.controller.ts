import { Request, Response } from "express";
import { Store } from "./store.model";
import { Category } from "../categories/category.model";
import { Product } from "../products/product.model";
import { Review } from "../reviews/review.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { getSellerContext } from "./seller-store.util";
import { createNotification } from "../notifications/notification.service";
import { logger } from "../../utils/logger";
import mongoose from "mongoose";

function safeObjectId(id: string) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}

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
  businessInfo?: {
    categoryId?: unknown;
  };
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
 * public-safe shape. Excludes ownerId, sensitive businessInfo, rejectionReason,
 * verifiedAt, and verifiedBy, but preserves safe public category information.
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
    businessInfo?: {
      categoryId?: unknown;
    };
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
    businessInfo: store.businessInfo ? {
      categoryId: store.businessInfo.categoryId,
    } : undefined,
  };
}

/**
 * Controller: Register Store (Seller Application / Re-submission)
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID (owner)
 *    - req.body: storeName, description, logo, banner, businessInfo (including categoryId)
 * 2. Database Operation:
 *    - Store.findOne({ ownerId }) to check if store already exists or was rejected
 *    - Category.findById(categoryId) to verify category exists
 *    - Store.create(...) to register new store application with categoryId ObjectId reference
 * 3. Response Sent:
 *    - HTTP 201 (or 200 on resubmit): Created/updated store JSON object
 */
export const registerStore = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Store.findOne({ ownerId: req.user!.id });
  const { storeName, description, logo, banner, businessInfo } = req.body;

  const categoryId = businessInfo?.categoryId;

  if (!categoryId) {
    throw ApiError.badRequest("Category is required");
  }

  // Verify category exists
  const category = await Category.findById(categoryId);
  if (!category) {
    throw ApiError.badRequest("Invalid category: category does not exist");
  }

  if (existing) {
    if (existing.status === "rejected") {
      existing.storeName = storeName || existing.storeName;
      existing.description = description || existing.description;
      if (logo !== undefined) existing.logo = logo;
      if (banner !== undefined) existing.banner = banner;
      if (businessInfo) {
        existing.businessInfo = {
          ...(existing.businessInfo || {}),
          ...businessInfo,
          categoryId: new mongoose.Types.ObjectId(categoryId),
        };
      }
      existing.status = "pending";
      existing.rejectionReason = undefined;
      await existing.save();

      // Dispatch real-time in-app notifications
      try {
        await createNotification({
          userId: req.user!.id,
          type: "seller_approval",
          title: "Application Resubmitted",
          message: `Your seller application for "${existing.storeName}" has been resubmitted and is awaiting admin review.`,
          link: "/become-seller",
          relatedId: existing._id.toString(),
        });

        const db = mongoose.connection.db;
        if (db) {
          const admins = await db.collection("user").find({ role: "admin" }).project({ id: 1, _id: 1 }).toArray();
          for (const admin of admins) {
            const adminId = admin.id || admin._id.toString();
            await createNotification({
              userId: adminId,
              type: "seller_approval",
              title: "Seller Application Resubmitted",
              message: `Merchant "${existing.storeName}" has resubmitted their application for review.`,
              link: `/dashboard/admin/sellers/${existing._id.toString()}`,
              relatedId: existing._id.toString(),
            });
          }
        }
      } catch (notifErr) {
        logger.warn("Could not dispatch application resubmission notification", notifErr);
      }

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
      businessInfo: {
        ...businessInfo,
        categoryId: new mongoose.Types.ObjectId(categoryId),
      },
      location: req.body.location ? {
        latitude: req.body.location.latitude,
        longitude: req.body.location.longitude,
        address: req.body.location.address || businessInfo?.businessAddress,
      } : undefined,
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

  // Dispatch real-time in-app notifications
  try {
    await createNotification({
      userId: req.user!.id,
      type: "seller_approval",
      title: "Seller Application Submitted",
      message: `Your application for "${store.storeName}" has been received and is pending KYC verification.`,
      link: "/become-seller",
      relatedId: store._id.toString(),
    });

    const db = mongoose.connection.db;
    if (db) {
      const admins = await db.collection("user").find({ role: "admin" }).project({ id: 1, _id: 1 }).toArray();
      for (const admin of admins) {
        const adminId = admin.id || admin._id.toString();
        await createNotification({
          userId: adminId,
          type: "seller_approval",
          title: "New Seller Application",
          message: `New seller application received for "${store.storeName}".`,
          link: `/dashboard/admin/sellers/${store._id.toString()}`,
          relatedId: store._id.toString(),
        });
      }
    }
  } catch (notifErr) {
    logger.warn("Could not dispatch new seller application notification", notifErr);
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
 *    - req.body: storeName, description, logo, banner, businessInfo (including categoryId), resubmit
 * 2. Database Operation:
 *    - Store.findOne({ ownerId }), updates properties, store.save()
 *    - Category.findById(categoryId) to verify category exists if provided
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
    const categoryId = businessInfo.categoryId;
    if (categoryId) {
      // Verify category exists
      const category = await Category.findById(categoryId);
      if (!category) {
        throw ApiError.badRequest("Invalid category: category does not exist");
      }
      store.businessInfo = {
        ...(store.businessInfo || {}),
        ...businessInfo,
        categoryId: new mongoose.Types.ObjectId(categoryId),
      };
    } else {
      store.businessInfo = {
        ...(store.businessInfo || {}),
        ...businessInfo,
      };
    }
  }

  // Fallback to businessInfo address if location address is omitted
  if (req.body.location) {
    store.location = {
      latitude: req.body.location.latitude,
      longitude: req.body.location.longitude,
      address: req.body.location.address || store.businessInfo?.businessAddress,
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
  if (!store) throw ApiError.notFound("Store not found");

  const isOwner = req.user?.id === store.ownerId;
  const isAdmin = req.user?.role === "admin";

  if (store.status === "rejected" || (store.status === "suspended" && !isOwner && !isAdmin))
    throw ApiError.notFound("Store not found");

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
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 12));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "highest_rated";

  const filter: Record<string, unknown> = { status: "approved" as const };

  if (search) {
    const regex = new RegExp(search, "i");
    filter.$or = [{ storeName: regex }, { slug: regex }, { description: regex }];
  }

  if (category && category !== "all" && category !== "All Stores" && category !== "All") {
    let catOids: mongoose.Types.ObjectId[] = [];
    const directOid = safeObjectId(category);
    if (directOid) {
      catOids.push(directOid);
    } else {
      const cleanName = category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cleanSlug = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const catDocs = await Category.find({
        $or: [
          { slug: cleanSlug },
          { slug: category.toLowerCase() },
          { name: new RegExp(`^${cleanName}$`, "i") },
          { name: new RegExp(cleanName, "i") },
        ],
      }).select("_id");
      catOids = catDocs.map((c) => c._id);
    }

    if (catOids.length > 0) {
      filter["businessInfo.categoryId"] = { $in: catOids };
    }
  }

  let sortQuery: Record<string, 1 | -1> = { createdAt: -1 };
  if (sort === "Highest Rated" || sort === "highest_rated") {
    sortQuery = { rating: -1, ratingCount: -1, createdAt: -1 };
  } else if (sort === "Most Popular" || sort === "most_popular") {
    sortQuery = { followersCount: -1, ratingCount: -1, createdAt: -1 };
  } else if (sort === "Newest" || sort === "newest") {
    sortQuery = { createdAt: -1 };
  }

  const [total, totalApprovedStores, allCategories, globalStoreCategoryAgg] = await Promise.all([
    Store.countDocuments(filter),
    Store.countDocuments({ status: "approved" }),
    Category.find().select("_id name slug").lean(),
    Store.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: "$businessInfo.categoryId", count: { $sum: 1 } } },
    ]),
  ]);

  const catNameById = new Map<string, string>();
  for (const cat of allCategories) {
    catNameById.set(cat._id.toString(), cat.name);
  }

  const categoryCounts: Record<string, number> = {};
  for (const row of globalStoreCategoryAgg) {
    if (row._id) {
      const catName = catNameById.get(String(row._id)) || "General";
      categoryCounts[catName] = (categoryCounts[catName] || 0) + row.count;
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;

  const stores = await Store.find(filter)
    .populate("businessInfo.categoryId", "name slug image")
    .sort(sortQuery)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  // If some stores have unpopulated categoryId (e.g. raw string), batch lookup
  const rawCatIds: mongoose.Types.ObjectId[] = [];
  stores.forEach((s) => {
    const rawCat = s.businessInfo?.categoryId;
    if (rawCat && typeof rawCat === "string") {
      try {
        const oid = new mongoose.Types.ObjectId(rawCat);
        rawCatIds.push(oid);
      } catch {}
    }
  });

  let catMap = new Map<string, any>();
  if (rawCatIds.length > 0) {
    const catDocs = await Category.find({ _id: { $in: rawCatIds } }).select("name slug image").lean();
    catMap = new Map(catDocs.map((c) => [String(c._id), { id: String(c._id), name: c.name, slug: c.slug, image: c.image }]));
  }

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

  const productIds = products.map((p) => p._id.toString());
  const productToStoreMap = new Map<string, string>();
  for (const product of products) {
    productToStoreMap.set(product._id.toString(), product.storeId);
  }

  const reviews = productIds.length
    ? await Review.find({ productId: { $in: productIds } }).select("productId rating").lean()
    : [];

  const storeReviewsMap = new Map<string, number[]>();
  for (const review of reviews) {
    const storeId = productToStoreMap.get(review.productId);
    if (storeId) {
      const list = storeReviewsMap.get(storeId) || [];
      list.push(review.rating);
      storeReviewsMap.set(storeId, list);
    }
  }

  const productsByStore = new Map<string, typeof products>();
  for (const product of products) {
    const storeProducts = productsByStore.get(product.storeId) || [];
    storeProducts.push(product);
    productsByStore.set(product.storeId, storeProducts);
  }

  const resultStores = stores.map((store) => {
    if (
      store.businessInfo?.categoryId &&
      typeof store.businessInfo.categoryId === "string" &&
      catMap.has(store.businessInfo.categoryId)
    ) {
      store.businessInfo.categoryId = catMap.get(store.businessInfo.categoryId);
    }

    const storeProducts =
      productsByStore.get(store._id.toString()) ||
      productsByStore.get(store.slug) ||
      productsByStore.get(store.ownerId) ||
      [];
    const salesNumber = storeProducts.reduce((total, product) => total + (product.sold || 0), 0);

    const storeIdKey = store._id.toString();
    const storeSlugKey = store.slug;
    const storeOwnerKey = store.ownerId;

    const ratingsList = [
      ...(storeReviewsMap.get(storeIdKey) || []),
      ...(storeSlugKey ? (storeReviewsMap.get(storeSlugKey) || []) : []),
      ...(storeOwnerKey ? (storeReviewsMap.get(storeOwnerKey) || []) : []),
    ];

    let storeRating = 0;
    let storeRatingCount = ratingsList.length;

    if (ratingsList.length > 0) {
      storeRating = Number((ratingsList.reduce((sum, r) => sum + r, 0) / ratingsList.length).toFixed(1));
    } else {
      const ratedProducts = storeProducts.filter((p) => p.ratingAvg && p.ratingAvg > 0);
      if (ratedProducts.length > 0) {
        const totalRating = ratedProducts.reduce((sum, p) => sum + (p.ratingAvg || 0), 0);
        storeRating = Number((totalRating / ratedProducts.length).toFixed(1));
        storeRatingCount = ratedProducts.reduce((sum, p) => sum + (p.ratingCount || 1), 0);
      } else {
        storeRating = 0;
        storeRatingCount = 0;
      }
    }

    return {
      ...toPublicStore(store),
      rating: storeRating,
      ratingCount: storeRatingCount,
      products: storeProducts.slice(0, 3),
      salesNumber,
    };
  });

  // Sort by rating, reviews count, sales, and trust score
  resultStores.sort((a, b) => {
    const ratingA = Number(a.rating || 0);
    const ratingB = Number(b.rating || 0);
    const countA = Number(a.ratingCount || 0);
    const countB = Number(b.ratingCount || 0);
    const salesA = Number(a.salesNumber || 0);
    const salesB = Number(b.salesNumber || 0);
    const trustA = Number(a.trustScore || 0);
    const trustB = Number(b.trustScore || 0);

    if (ratingB !== ratingA) return ratingB - ratingA;
    if (countB !== countA) return countB - countA;
    if (salesB !== salesA) return salesB - salesA;
    return trustB - trustA;
  });

  // Return server-side pagination metadata with global category counts
  res.status(200).json({
    data: resultStores,
    items: resultStores,
    total,
    totalApprovedStores,
    categoryCounts,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

/**
 * Controller: Submit Store Appeal
 * Allows a suspended seller to submit an official appeal request with remediation details.
 */
export const submitStoreAppeal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { reason, email } = req.body as { reason: string; email?: string };

  if (!reason || !reason.trim()) {
    throw ApiError.badRequest("Appeal explanation reason is required");
  }

  const store = await Store.findOne({ ownerId: userId });
  if (!store) {
    throw ApiError.notFound("No store found for this account");
  }

  if (store.status !== "suspended") {
    throw ApiError.badRequest("Appeals can only be submitted for suspended stores");
  }

  store.appeal = {
    reason: reason.trim(),
    email: email?.trim() || req.user?.email || "",
    submittedAt: new Date(),
    status: "pending",
  };

  await store.save();

  // Notify applicant and all admin users
  try {
    await createNotification({
      userId,
      type: "seller_approval",
      title: "Appeal Statement Received",
      message: `Your compliance appeal for "${store.storeName}" has been received. Our review desk will respond within 24–48 hours.`,
      link: "/become-seller",
      relatedId: store._id.toString(),
    });

    const db = mongoose.connection.db;
    if (db) {
      const admins = await db.collection("user").find({ role: "admin" }).project({ id: 1, _id: 1 }).toArray();
      for (const admin of admins) {
        const adminId = admin.id || admin._id.toString();
        await createNotification({
          userId: adminId,
          type: "seller_approval",
          title: "📬 Merchant Compliance Appeal",
          message: `Store "${store.storeName}" submitted a compliance appeal: "${reason.slice(0, 80)}${reason.length > 80 ? "..." : ""}"`,
          link: `/dashboard/admin/sellers/${store._id.toString()}`,
          relatedId: store._id.toString(),
        });
      }
    }
  } catch (err) {
    logger.warn("Could not dispatch appeal notifications", err);
  }

  sendSuccess(res, {
    message: "Appeal submitted successfully. Compliance desk will review within 24-48 business hours.",
    store,
  });
});
