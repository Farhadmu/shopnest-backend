import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { SellerGoal } from "../seller-intelligence.model";
import { getSellerContext } from "../seller-store.util";

// 19. SELLER GOALS & KPI SYSTEM
export const getSellerGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const {
    store,
    products,
    totalRevenue,
    deliveredOrders,
    totalOrders,
    uniqueBuyerIds,
  } = await getSellerContext(userId);

  const storeIdStr = store._id?.toString() || store.id;
  const goals = await SellerGoal.find({
    $or: [{ storeId: storeIdStr }, { sellerId: userId }],
  }).sort({ createdAt: -1 });

  // Keep goal current values synced to live database metrics
  const updatedGoals = goals.map((g) => {
    let liveValue = g.currentValue;
    if (g.metricType === "revenue") liveValue = totalRevenue;
    else if (g.metricType === "orders") liveValue = deliveredOrders || totalOrders;
    else if (g.metricType === "products") liveValue = products.length;
    else if (g.metricType === "customers") liveValue = uniqueBuyerIds.length;
    else if (g.metricType === "rating") liveValue = store.rating || 0;

    const target = g.targetValue || 1;
    const isAchieved = liveValue >= target;
    const isOverdue = new Date(g.deadline).getTime() < Date.now();

    return {
      ...g.toJSON(),
      currentValue: liveValue,
      status: isAchieved ? "achieved" : isOverdue ? "missed" : "in_progress",
    };
  });

  sendSuccess(res, updatedGoals);
});

export const createSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const {
    store,
    products,
    totalRevenue,
    deliveredOrders,
    totalOrders,
    uniqueBuyerIds,
  } = await getSellerContext(userId);

  const { title, metricType = "revenue", targetValue = 50000, unit, deadline, period } = req.body;
  const storeIdStr = store._id?.toString() || store.id;

  let initialCurrent = 0;
  if (metricType === "revenue") initialCurrent = totalRevenue;
  else if (metricType === "orders") initialCurrent = deliveredOrders || totalOrders;
  else if (metricType === "products") initialCurrent = products.length;
  else if (metricType === "customers") initialCurrent = uniqueBuyerIds.length;
  else if (metricType === "rating") initialCurrent = store.rating || 0;

  const defaultUnit = metricType === "revenue" ? "৳" : metricType === "rating" ? "★" : "units";

  const goal = await SellerGoal.create({
    sellerId: userId,
    storeId: storeIdStr,
    title,
    metricType,
    targetValue: Number(targetValue),
    currentValue: initialCurrent,
    unit: unit || defaultUnit,
    deadline: deadline ? new Date(deadline) : new Date(Date.now() + 30 * 24 * 3600 * 1000),
    period: period || "monthly",
    status: initialCurrent >= Number(targetValue) ? "achieved" : "in_progress",
  });

  sendSuccess(res, goal.toJSON(), "Goal created", 201);
});

export const deleteSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await SellerGoal.findByIdAndDelete(id);
  sendSuccess(res, { deleted: true }, "Goal removed");
});

