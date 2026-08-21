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
  const { status } = req.query as { status?: string };
  const stores = await Store.find(status ? { status } : {}).sort({ createdAt: -1 });
  res.status(200).json(stores);
});

export const updateSellerStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: "pending" | "approved" | "rejected" | "suspended" };
  const store = await Store.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!store) throw ApiError.notFound("Store not found");

  await logSecurityEvent("ADMIN_ACTION", `Seller store ${store.storeName} set to ${status}`, {
    userId: req.user!.id,
    details: { storeId: store.id, status },
  });
  recomputeStoreTrustScore(store.id).catch(() => undefined);

  sendSuccess(res, store.toJSON(), `Store ${status}`);
});

export const listReportedReviews = asyncHandler(async (_req: Request, res: Response) => {
  const reviews = await Review.find({ reported: true }).sort({ createdAt: -1 });
  res.status(200).json(reviews);
});
