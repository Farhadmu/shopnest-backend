import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { LoyaltyPoints } from "../customer-features.model";
import { LoyaltyTransaction } from "../customer-features.model";

export const getLoyaltyStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) loyalty = await LoyaltyPoints.create({ userId, totalPoints: 0, availablePoints: 0, lifetimePoints: 0, level: "bronze" });

  const levelThresholds = { bronze: 0, silver: 500, gold: 1500, platinum: 5000 };
  const nextLevel = loyalty.level === "bronze" ? "silver" : loyalty.level === "silver" ? "gold" : loyalty.level === "gold" ? "platinum" : null;
  const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;
  const progress = nextThreshold ? Math.round((loyalty.lifetimePoints / nextThreshold) * 100) : 100;

  sendSuccess(res, {
    ...loyalty.toJSON(), nextLevel, nextThreshold, progress: Math.min(100, progress),
    benefits: {
      bronze: ["Earn 1 point per ৳100", "Birthday coupon"],
      silver: ["Earn 1.5 points per ৳100", "Free delivery on orders above ৳1000", "Early access to sales"],
      gold: ["Earn 2 points per ৳100", "Free delivery on all orders", "Priority support", "Exclusive deals"],
      platinum: ["Earn 3 points per ৳100", "Free delivery + returns", "VIP support", "Personal shopper"],
    },
  });
});

export const getLoyaltyTransactions = asyncHandler(async (req: Request, res: Response) => {
  const transactions = await LoyaltyTransaction.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, transactions);
});

export const redeemPoints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { points, rewardType } = req.body;

  const loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) throw ApiError.notFound("Loyalty account not found");
  if (loyalty.availablePoints < points) throw ApiError.badRequest("Insufficient points");

  let reward = "";
  switch (rewardType) {
    case "coupon": reward = "SAVE" + points; break;
    case "free_delivery": reward = "FREESHIP"; break;
    case "discount": reward = `DISCOUNT${points}`; break;
  }

  loyalty.availablePoints -= points;
  await loyalty.save();

  await LoyaltyTransaction.create({ userId, type: "redeemed", points: -points, description: `Redeemed for ${rewardType}`, balanceAfter: loyalty.availablePoints });
  sendSuccess(res, { success: true, reward, remainingPoints: loyalty.availablePoints });
});

// ============================================================
// ADDRESS INTELLIGENCE (Feature 27)
// ============================================================
