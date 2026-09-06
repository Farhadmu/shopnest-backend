import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { ProductLifecycle } from "../customer-intelligence.model";
import { getUserId } from "../../../utils/getUserId";

// PRODUCT LIFE-CYCLE TRACKER
export const getProductLifecycle = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const lifecycles = await ProductLifecycle.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, lifecycles);
});

export const updateMaintenanceReminder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reminderIndex, status } = req.body;

  const lifecycle = await ProductLifecycle.findById(id);
  if (!lifecycle) throw ApiError.notFound("Lifecycle record not found");

  if (lifecycle.maintenanceReminders[reminderIndex]) {
    lifecycle.maintenanceReminders[reminderIndex].status = status;
    await lifecycle.save();
  }

  sendSuccess(res, lifecycle.toJSON(), "Maintenance status updated");
});
