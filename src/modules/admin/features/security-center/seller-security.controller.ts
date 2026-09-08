import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { Store } from "../../../sellers/store.model";

// 6. SELLER SECURITY
export const getSellerSecurity = asyncHandler(async (req: Request, res: Response) => {
  const { status, riskLevel, page = 1, limit = 20 } = req.query as {
    status?: string; riskLevel?: string; page?: string; limit?: string;
  };

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;

  let storeQuery = Store.find(filter);
  if (riskLevel === "high") storeQuery = Store.find({ ...filter, trustScore: { $lt: 40 } });
  if (riskLevel === "medium") storeQuery = Store.find({ ...filter, trustScore: { $gte: 40, $lt: 70 } });
  if (riskLevel === "low") storeQuery = Store.find({ ...filter, trustScore: { $gte: 70 } });

  const [sellers, total, verifiedCount, pendingCount, suspendedCount] = await Promise.all([
    storeQuery.sort({ trustScore: -1 }).skip(skip).limit(Number(limit)),
    Store.countDocuments(filter),
    Store.countDocuments({ status: "approved" }),
    Store.countDocuments({ status: "pending" }),
    Store.countDocuments({ status: "suspended" }),
  ]);

  const highRiskCount = await Store.countDocuments({ trustScore: { $lt: 40 }, status: "approved" });
  const mediumRiskCount = await Store.countDocuments({ trustScore: { $gte: 40, $lt: 70 }, status: "approved" });
  const lowRiskCount = await Store.countDocuments({ trustScore: { $gte: 70 }, status: "approved" });

  sendSuccess(res, {
    sellers: sellers.map((s) => ({
      id: s._id,
      storeName: s.storeName,
      ownerId: s.ownerId,
      status: s.status,
      trustScore: s.trustScore,
      rating: s.rating,
      riskLevel: s.trustScore < 40 ? "high" : s.trustScore < 70 ? "medium" : "low",
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: {
      total,
      verified: verifiedCount,
      pending: pendingCount,
      suspended: suspendedCount,
      highRisk: highRiskCount,
      mediumRisk: mediumRiskCount,
      lowRisk: lowRiskCount,
    },
  });
});
