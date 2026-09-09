import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";
import { SellerGoal } from "../seller-intelligence.model";
import { getSellerStore } from "../seller-store.util";

// 19. SELLER GOALS & KPI SYSTEM
export const getSellerGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const orders = await Order.find({ "items.storeId": store.id });
  const realRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const realDelivered = orders.filter((o) => o.status === "delivered").length;

  const goals = await SellerGoal.find({ storeId: store.id });

  // Keep goal current values synced to live database metrics
  for (const g of goals) {
    if (g.metricType === "revenue") g.currentValue = realRevenue;
    if (g.metricType === "orders") g.currentValue = realDelivered;
  }

  sendSuccess(res, goals);
});

export const createSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);
  const { title, metricType, targetValue, unit, deadline, period } = req.body;

  const goal = await SellerGoal.create({
    sellerId: userId,
    storeId: store.id,
    title,
    metricType,
    targetValue: Number(targetValue),
    currentValue: 0,
    unit: unit || "৳",
    deadline: new Date(deadline),
    period: period || "monthly",
    status: "in_progress",
  });

  sendSuccess(res, goal.toJSON(), "Goal created", 201);
});

export const deleteSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await SellerGoal.findByIdAndDelete(id);
  sendSuccess(res, { deleted: true }, "Goal removed");
});
