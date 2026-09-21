import { Request, Response } from "express";
import mongoose from "mongoose";
import { Store } from "../sellers/store.model";
import { Category } from "../categories/category.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { Review } from "../reviews/review.model";
import { recomputeStoreTrustScore } from "../trust/trust.service";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { logSecurityEvent } from "../security/security.service";
import { createNotification } from "../notifications/notification.service";
import { logger } from "../../utils/logger";

function safeObjectId(id: string) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}

/**
 * Controller: Get Admin Dashboard Metrics
 *
 * 1. Inputs Extracted:
 *    - None (admin authenticated)
 * 2. Database Operation:
 *    - Counts users, approved sellers, active products, total orders, pending stores, pending products, refund requests
 *    - Order.aggregate(...) to sum paid revenue
 * 3. Response Sent:
 *    - HTTP 200: { totalUsers, totalSellers, totalProducts, totalOrders, totalRevenue, pendingSellers, reportedProducts, refundRequests }
 */
export const getDashboardMetrics = asyncHandler(async (_req: Request, res: Response) => {
  const db = mongoose.connection.db;

  const [
    totalUsers,
    totalSellers,
    totalProducts,
    totalOrders,
    revenueAgg,
    pendingSellers,
    reportedProducts,
    refundRequests,
  ] = await Promise.all([
    db ? db.collection("user").countDocuments() : 0,
    Store.countDocuments({ status: "approved" }),
    Product.countDocuments({ isDeleted: false }),
    Order.countDocuments(),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Store.countDocuments({ status: "pending" }),
    Product.countDocuments({ status: "pending" }),
    Order.countDocuments({ status: { $in: ["returned", "refunded"] } }),
  ]);

  sendSuccess(res, {
    totalUsers,
    totalSellers,
    totalProducts,
    totalOrders,
    totalRevenue: revenueAgg[0]?.total ?? 0,
    pendingSellers,
    reportedProducts,
    refundRequests,
  });
});

/**
 * Controller: List Sellers For Moderation
 *
 * 1. Inputs Extracted:
 *    - req.query.status: Optional status filter ("pending", "approved", "rejected", "suspended")
 *    - req.query.search: Optional search term matching store name, slug, phone, NID, etc.
 * 2. Database Operation:
 *    - Store.find(filter).populate('businessInfo.categoryId').sort({ createdAt: -1 })
 *    - Enriches each store with owner email, full name, and avatar from better-auth user collection
 * 3. Response Sent:
 *    - HTTP 200: Array of enriched store objects with populated category
 */
export const listSellersForModeration = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = req.query as { status?: string; search?: string };
  const filter: Record<string, unknown> = {};

  if (status && status !== "all") {
    filter.status = status;
  }

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { storeName: regex },
      { slug: regex },
      { description: regex },
      { "businessInfo.ownerName": regex },
      { "businessInfo.contactPhone": regex },
      { "businessInfo.nidOrTradeLicense": regex },
    ];
  }

  const stores = await Store.find(filter)
    .populate("businessInfo.categoryId", "name slug image")
    .sort({ createdAt: -1 });

  const db = mongoose.connection.db;
  if (db && stores.length > 0) {
    const ownerIds = stores.map((s) => s.ownerId);
    const validObjectIds = ownerIds
      .map((id) => safeObjectId(id))
      .filter((id): id is mongoose.Types.ObjectId => id !== null);

    // Collect any categoryIds that were not populated (e.g. if saved as raw string ID)
    const rawCatIds: mongoose.Types.ObjectId[] = [];
    stores.forEach((s) => {
      const rawCat = s.businessInfo?.categoryId;
      if (rawCat && typeof rawCat === "string") {
        const oid = safeObjectId(rawCat);
        if (oid) rawCatIds.push(oid);
      }
    });

    let catMap = new Map<string, any>();
    if (rawCatIds.length > 0) {
      const catDocs = await Category.find({ _id: { $in: rawCatIds } }).select("name slug image").lean();
      catMap = new Map(catDocs.map((c) => [String(c._id), { id: String(c._id), name: c.name, slug: c.slug, image: c.image }]));
    }

    const userDocs = await db
      .collection("user")
      .find({
        $or: [{ id: { $in: ownerIds } }, { _id: { $in: validObjectIds } }],
      })
      .toArray();

    const userMap = new Map(userDocs.map((u) => [String(u.id ?? u._id), u]));

    const enriched = stores.map((store) => {
      const u = userMap.get(store.ownerId);
      const json = store.toJSON();
      if (
        json.businessInfo?.categoryId &&
        typeof json.businessInfo.categoryId === "string" &&
        catMap.has(json.businessInfo.categoryId)
      ) {
        json.businessInfo.categoryId = catMap.get(json.businessInfo.categoryId);
      }
      return {
        ...json,
        ownerEmail: u?.email || null,
        ownerFullName: u?.name || json.businessInfo?.ownerName || null,
        ownerImage: u?.image || null,
      };
    });

    return res.status(200).json(enriched);
  }

  res.status(200).json(stores);
});

/**
 * Controller: Get Single Seller Details For Admin
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Store ID
 * 2. Database Operation:
 *    - Store.findById(id).populate('businessInfo.categoryId')
 *    - Queries user collection for owner info
 *    - Queries Product and Order for store performance metrics
 * 3. Response Sent:
 *    - HTTP 200: Detailed seller dossier with populated category { ...store, ownerEmail, ownerFullName, metrics: { totalProducts, totalOrders, totalSales }, recentProducts }
 */
export const getSellerDetailsForAdmin = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findById(req.params.id).populate("businessInfo.categoryId", "name slug image");
  if (!store) throw ApiError.notFound("Store not found");

  const storeJson = store.toJSON();
  if (storeJson.businessInfo?.categoryId && typeof storeJson.businessInfo.categoryId === "string") {
    const catDoc = await Category.findById(storeJson.businessInfo.categoryId).select("name slug image").lean();
    if (catDoc) {
      storeJson.businessInfo.categoryId = { id: String(catDoc._id), name: catDoc.name, slug: catDoc.slug, image: catDoc.image };
    }
  }

  const db = mongoose.connection.db;
  let ownerUser: any = null;
  if (db) {
    const userOid = safeObjectId(store.ownerId);
    ownerUser = await db.collection("user").findOne({
      $or: [{ id: store.ownerId }, ...(userOid ? [{ _id: userOid }] : [])],
    });
  }

  const [totalProducts, orderAgg, recentProducts] = await Promise.all([
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
    Product.find({ storeId: store.id, isDeleted: false }).sort({ createdAt: -1 }).limit(6).lean(),
  ]);

  const totalSales = orderAgg[0]?.totalSales ?? 0;
  const totalOrders = orderAgg[0]?.totalOrders?.length ?? 0;

  const result = {
    ...storeJson,
    ownerEmail: ownerUser?.email || null,
    ownerFullName: ownerUser?.name || store.businessInfo?.ownerName || null,
    ownerImage: ownerUser?.image || null,
    ownerRole: ownerUser?.role || "customer",
    ownerCreatedAt: ownerUser?.createdAt || null,
    metrics: {
      totalProducts,
      totalOrders,
      totalSales,
    },
    recentProducts,
  };

  sendSuccess(res, result);
});

/**
 * Controller: Update Seller Application / Store Status (Approve / Reject / Suspend)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Store ID
 *    - req.body: status ("pending" | "approved" | "rejected" | "suspended"), rejectionReason
 * 2. Database Operation:
 *    - Store.findByIdAndUpdate(id, updateFields, { new: true }).populate('businessInfo.categoryId')
 *    - Updates user role in "user" collection to "seller" or "customer"
 *    - Creates an in-app notification for the seller
 * 3. Response Sent:
 *    - HTTP 200: Updated store document with status message and populated category
 */
export const updateSellerStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, rejectionReason, suspensionReason } = req.body as {
    status: "pending" | "approved" | "rejected" | "suspended";
    rejectionReason?: string;
    suspensionReason?: string;
  };

  const updateFields: Record<string, unknown> = { status };
  const unsetFields: Record<string, unknown> = {};
  const effectiveReason = suspensionReason || rejectionReason;

  if (status === "suspended") {
    if (effectiveReason !== undefined) {
      updateFields.suspensionReason = effectiveReason;
      updateFields.rejectionReason = effectiveReason;
    }
    // Clear past appeal so seller has a fresh appeal submission form
    unsetFields.appeal = 1;
  } else if (status === "rejected") {
    if (effectiveReason !== undefined) {
      updateFields.rejectionReason = effectiveReason;
    }
  } else if (status === "approved") {
    updateFields.verifiedAt = new Date();
    updateFields.verifiedBy = req.user!.id;
    updateFields.rejectionReason = "";
    updateFields.suspensionReason = "";
    unsetFields.appeal = 1;
  }

  const updateQuery: Record<string, unknown> = { $set: updateFields };
  if (Object.keys(unsetFields).length > 0) {
    updateQuery.$unset = unsetFields;
  }

  const store = await Store.findByIdAndUpdate(req.params.id, updateQuery, { new: true }).populate(
    "businessInfo.categoryId",
    "name slug image"
  );
  if (!store) throw ApiError.notFound("Store not found");

  // Sync role to better-auth's user collection (Modern pattern: keep 'seller' role on suspension so seller can access dashboard read-only/appeal)
  try {
    const db = mongoose.connection.db;
    if (db) {
      const userOid = safeObjectId(store.ownerId);
      if (status === "approved") {
        await db.collection("user").updateOne(
          { $or: [{ id: store.ownerId }, ...(userOid ? [{ _id: userOid }] : [])] },
          { $set: { role: "seller" } }
        );
      } else if (status === "rejected") {
        await db.collection("user").updateOne(
          { $or: [{ id: store.ownerId }, ...(userOid ? [{ _id: userOid }] : [])] },
          { $set: { role: "customer" } }
        );
      }
      // Note: On "suspended", role remains "seller" with store.status="suspended"
    }
  } catch (err) {
    logger.warn("Could not sync role to user collection on seller status update", err);
  }

  // Push real-time in-app notification to the seller
  try {
    let title = "Store Status Update";
    let message = `Your store "${store.storeName}" status is now ${status}.`;
    let link = "/become-seller";

    if (status === "approved") {
      title = "🎉 Store Approved!";
      message = `Congratulations! Your store "${store.storeName}" has been verified and approved. You can now access your Seller Dashboard.`;
      link = "/dashboard/seller";
    } else if (status === "rejected") {
      title = "⚠️ Seller Application Update";
      message = `Your application for "${store.storeName}" was not approved.${effectiveReason ? ` Reason: ${effectiveReason}` : " You may review your information and resubmit."}`;
      link = "/become-seller";
    } else if (status === "suspended") {
      title = "🚨 Store Suspended";
      message = `Your store "${store.storeName}" has been suspended by an administrator.${effectiveReason ? ` Reason: ${effectiveReason}` : " Please review the compliance notice in your Seller Dashboard."}`;
      link = "/become-seller";
    }

    await createNotification({
      userId: store.ownerId,
      type: "seller_approval",
      title,
      message,
      link,
      relatedId: store.id,
    });
  } catch (err) {
    logger.warn("Could not send store status notification to seller", err);
  }

  await logSecurityEvent("ADMIN_ACTION", `Seller store ${store.storeName} set to ${status}`, {
    userId: req.user!.id,
    details: { storeId: store.id, status, rejectionReason },
  });
  recomputeStoreTrustScore(store.id).catch(() => undefined);
  const isSuspended = status !== "approved";
  await Product.updateMany({ storeId: store._id.toString() }, { storeSuspended: isSuspended });

  sendSuccess(res, store.toJSON(), `Store status updated to ${status}`);
});

/**
 * Controller: List Reported Reviews For Moderation
 *
 * 1. Inputs Extracted:
 *    - None (admin authenticated)
 * 2. Database Operation:
 *    - Review.find({ reported: true }).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of reported reviews
 */
export const listReportedReviews = asyncHandler(async (_req: Request, res: Response) => {
  const reviews = await Review.find({ reported: true }).sort({ createdAt: -1 });
  res.status(200).json(reviews);
});
