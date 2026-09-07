import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { ShoppingGoal } from "../customer-intelligence.model";
import { getUserId } from "../../../utils/getUserId";

// PERSONAL SHOPPING GOALS
export const getGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const goals = await ShoppingGoal.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, goals);
});

export const createGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { title, category, targetBudget, targetDate, items = [] } = req.body;

  const completedCount = items.filter((i: { isCompleted?: boolean }) => i.isCompleted).length;
  const progressPercentage = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  const goal = await ShoppingGoal.create({
    userId,
    title,
    category,
    targetBudget: Number(targetBudget),
    targetDate: targetDate ? new Date(targetDate) : undefined,
    items,
    progressPercentage,
    status: progressPercentage === 100 ? "achieved" : "in_progress",
  });

  sendSuccess(res, goal.toJSON(), "Shopping goal created", 201);
});

export const updateGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const goal = await ShoppingGoal.findById(id);
  if (!goal) throw ApiError.notFound("Goal not found");

  const { title, targetBudget, targetDate, items, status } = req.body;

  if (title) goal.title = title;
  if (targetBudget !== undefined) goal.targetBudget = Number(targetBudget);
  if (targetDate) goal.targetDate = new Date(targetDate);
  if (items) {
    goal.items = items;
    const completedCount = items.filter((i: { isCompleted?: boolean }) => i.isCompleted).length;
    goal.progressPercentage = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
  }
  if (status) goal.status = status;
  if (goal.progressPercentage === 100) goal.status = "achieved";

  await goal.save();
  sendSuccess(res, goal.toJSON(), "Shopping goal updated");
});

export const deleteGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await ShoppingGoal.findByIdAndDelete(id);
  sendSuccess(res, { deleted: true }, "Shopping goal removed");
});
