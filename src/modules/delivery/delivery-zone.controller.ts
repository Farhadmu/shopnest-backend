import { Request, Response } from "express";
import { DeliveryZone } from "./delivery-zone.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const listDeliveryZones = asyncHandler(async (req: Request, res: Response) => {
  const zones = await DeliveryZone.find().sort({ type: 1, name: 1 });
  sendSuccess(res, zones);
});

export const createDeliveryZone = asyncHandler(async (req: Request, res: Response) => {
  const zone = await DeliveryZone.create(req.body);
  sendSuccess(res, zone.toJSON(), "Delivery zone created", 201);
});

export const updateDeliveryZone = asyncHandler(async (req: Request, res: Response) => {
  const zone = await DeliveryZone.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!zone) throw ApiError.notFound("Delivery zone not found");
  sendSuccess(res, zone.toJSON(), "Delivery zone updated");
});

export const deleteDeliveryZone = asyncHandler(async (req: Request, res: Response) => {
  const zone = await DeliveryZone.findByIdAndDelete(req.params.id);
  if (!zone) throw ApiError.notFound("Delivery zone not found");
  sendSuccess(res, { id: req.params.id }, "Delivery zone deleted");
});
