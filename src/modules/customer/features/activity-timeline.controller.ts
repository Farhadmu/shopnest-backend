import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { CustomerActivity } from "../customer-extras.model";

// 15. CUSTOMER ACTIVITY TIMELINE
export const getCustomerActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const activities = await CustomerActivity.find({ userId }).sort({ createdAt: -1 }).limit(30);
  sendSuccess(res, activities);
});

// CLEAR ACTIVITY TIMELINE (moved from customer-features.controller.ts)
export const clearActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  await CustomerActivity.deleteMany({ userId: req.user!.id });
  sendSuccess(res, { success: true }, "Activity timeline cleared");
});