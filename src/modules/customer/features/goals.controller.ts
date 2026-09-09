import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { ShoppingGoal } from "../customer-intelligence.model";
import { getUserId } from "../../../utils/getUserId";

function calculateGoalProgress(currentAmount: number, targetBudget: number) {
  const safeTarget = Number(targetBudget) || 0;
  const safeCurrent = Math.max(0, Number(currentAmount) || 0);
  const remaining = Math.max(0, safeTarget - safeCurrent);
  const percentage = safeTarget > 0 ? Math.min(100, Math.round((safeCurrent / safeTarget) * 100)) : 0;
  return { remaining, percentage };
}

// PERSONAL SHOPPING GOALS
export const getGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const goals = await ShoppingGoal.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, { items: goals, total: goals.length });
});

export const getGoalDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const goal = await ShoppingGoal.findOne({ _id: id, userId });
  if (!goal) throw ApiError.notFound("Goal not found");

  sendSuccess(res, goal.toJSON());
});

export const createGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { title, category, targetBudget, targetDate, relatedProductId, relatedCategoryId, notes, items = [] } = req.body;

  if (!title || !String(title).trim()) {
    throw ApiError.badRequest("Goal name is required");
  }
  const budget = Number(targetBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw ApiError.badRequest("Target amount must be a positive number");
  }

  const { remaining, percentage } = calculateGoalProgress(0, budget);

  const goal = await ShoppingGoal.create({
    userId,
    title: String(title).trim(),
    category: category || "General",
    targetBudget: budget,
    targetDate: targetDate ? new Date(targetDate) : undefined,
    relatedProductId: relatedProductId || undefined,
    relatedCategoryId: relatedCategoryId || undefined,
    notes: notes || undefined,
    items,
    currentAmount: 0,
    remainingAmount: remaining,
    progressPercentage: percentage,
    status: "active",
  });

  sendSuccess(res, goal.toJSON(), "Shopping goal created", 201);
});

export const updateGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const goal = await ShoppingGoal.findOne({ _id: id, userId });
  if (!goal) throw ApiError.notFound("Goal not found");

  const { title, targetBudget, targetDate, relatedProductId, relatedCategoryId, notes, items, status } = req.body;

  if (title !== undefined) {
    const trimmed = String(title).trim();
    if (!trimmed) throw ApiError.badRequest("Goal name cannot be empty");
    goal.title = trimmed;
  }
  if (targetBudget !== undefined) {
    const budget = Number(targetBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      throw ApiError.badRequest("Target amount must be a positive number");
    }
    goal.targetBudget = budget;
  }
  if (targetDate !== undefined) goal.targetDate = targetDate ? new Date(targetDate) : undefined;
  if (relatedProductId !== undefined) goal.relatedProductId = relatedProductId || undefined;
  if (relatedCategoryId !== undefined) goal.relatedCategoryId = relatedCategoryId || undefined;
  if (notes !== undefined) goal.notes = notes || undefined;
  if (items !== undefined) goal.items = items;

  const { remaining, percentage } = calculateGoalProgress(goal.currentAmount, goal.targetBudget);
  goal.remainingAmount = remaining;
  goal.progressPercentage = percentage;

  if (status === "cancelled") {
    goal.status = "cancelled";
  } else if (percentage >= 100 && goal.status !== "completed") {
    goal.status = "completed";
    goal.completedAt = new Date();
  } else if (status && status !== "cancelled") {
    goal.status = status;
  }

  await goal.save();
  sendSuccess(res, goal.toJSON(), "Shopping goal updated");
});

export const addProgress = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;
  const { amount } = req.body;

  const addAmount = Number(amount);
  if (!Number.isFinite(addAmount) || addAmount <= 0) {
    throw ApiError.badRequest("Progress amount must be a positive number");
  }

  const goal = await ShoppingGoal.findOne({ _id: id, userId });
  if (!goal) throw ApiError.notFound("Goal not found");

  if (goal.status === "completed") {
    throw ApiError.badRequest("Cannot add progress to a completed goal");
  }
  if (goal.status === "cancelled") {
    throw ApiError.badRequest("Cannot add progress to a cancelled goal");
  }

  const newCurrent = goal.currentAmount + addAmount;
  const { remaining, percentage } = calculateGoalProgress(newCurrent, goal.targetBudget);

  goal.currentAmount = Math.min(newCurrent, goal.targetBudget);
  goal.remainingAmount = remaining;
  goal.progressPercentage = percentage;

  if (percentage >= 100) {
    goal.status = "completed";
    goal.completedAt = new Date();
  }

  await goal.save();
  sendSuccess(res, goal.toJSON(), "Progress added");
});

export const deleteGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const goal = await ShoppingGoal.findOneAndDelete({ _id: id, userId });
  if (!goal) throw ApiError.notFound("Goal not found");

  sendSuccess(res, { deleted: true }, "Shopping goal removed");
});
