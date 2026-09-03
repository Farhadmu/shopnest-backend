import { Request, Response } from "express";
import mongoose from "mongoose";
import { Store } from "../sellers/store.model";
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

export const getDashboardMetrics = asyncHandler(async (_req: Request, res: Response) => {
  const db = mongoose.connection.db;

  const [totalUsers, totalSellers, totalProducts, totalOrders, revenueAgg, pendingSellers, reportedProducts, refundRequests] =
    await Promise.all([
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

  const stores = await Store.find(filter).sort({ createdAt: -1 });

  // Enrich with user profile details (email, registered name) from the user collection
  const db = mongoose.connection.db;
  if (db && stores.length > 0) {
    const ownerIds = stores.map((s) => s.ownerId);
    const validObjectIds = ownerIds.map((id) => safeObjectId(id)).filter((id): id is mongoose.Types.ObjectId => id !== null);

    const userDocs = await db
      .collection("user")
      .find({
        $or: [
          { id: { $in: ownerIds } },
          { _id: { $in: validObjectIds } },
        ],
      })
      .toArray();

    const userMap = new Map(userDocs.map((u) => [String(u.id ?? u._id), u]));

    const enriched = stores.map((store) => {
      const u = userMap.get(store.ownerId);
      const json = store.toJSON();
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

export const getSellerDetailsForAdmin = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw ApiError.notFound("Store not found");

  const db = mongoose.connection.db;
  let ownerUser: any = null;
  if (db) {
    const userOid = safeObjectId(store.ownerId);
    ownerUser = await db.collection("user").findOne({
      $or: [{ id: store.ownerId }, ...(userOid ? [{ _id: userOid }] : [])],
    });
  }

  // Get store performance and catalog metrics
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
    ...store.toJSON(),
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

export const updateSellerStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, rejectionReason } = req.body as {
    status: "pending" | "approved" | "rejected" | "suspended";
    rejectionReason?: string;
  };

  const updateFields: Record<string, unknown> = { status };
  if (rejectionReason !== undefined) updateFields.rejectionReason = rejectionReason;
  if (status === "approved") {
    updateFields.verifiedAt = new Date();
    updateFields.verifiedBy = req.user!.id;
    updateFields.rejectionReason = "";
  }

  const store = await Store.findByIdAndUpdate(req.params.id, updateFields, { new: true });
  if (!store) throw ApiError.notFound("Store not found");

  // Sync role to better-auth's `user` collection
  try {
    const db = mongoose.connection.db;
    if (db) {
      const targetRole = status === "approved" ? "seller" : "customer";
      const userOid = safeObjectId(store.ownerId);
      await db.collection("user").updateOne(
        { $or: [{ id: store.ownerId }, ...(userOid ? [{ _id: userOid }] : [])] },
        { $set: { role: targetRole } }
      );
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
      message = `Your application for "${store.storeName}" was not approved.${rejectionReason ? ` Reason: ${rejectionReason}` : " You may review your information and resubmit."}`;
      link = "/become-seller";
    } else if (status === "suspended") {
      title = "🚨 Store Suspended";
      message = `Your store "${store.storeName}" has been suspended by an administrator. Please contact support.`;
      link = "/support";
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
    logger.warn("Could not create notification for seller status update", err);
  }

  await logSecurityEvent("ADMIN_ACTION", `Seller store ${store.storeName} set to ${status}`, {
    userId: req.user!.id,
    details: { storeId: store.id, status, rejectionReason },
  });
  recomputeStoreTrustScore(store.id).catch(() => undefined);

  sendSuccess(res, store.toJSON(), `Store status updated to ${status}`);
});

export const listReportedReviews = asyncHandler(async (_req: Request, res: Response) => {
  const reviews = await Review.find({ reported: true }).sort({ createdAt: -1 });
  res.status(200).json(reviews);
});
