import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Address } from "../customer-extras.model";

export const getAddressesIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await Address.find({ userId: req.user!.id }).sort({ isDefault: -1, createdAt: -1 });
  sendSuccess(res, addresses);
});

export const createAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const existingCount = await Address.countDocuments({ userId });
  const address = await Address.create({ userId, ...req.body, isDefault: req.body.isDefault || existingCount === 0 });
  if (address.isDefault) await Address.updateMany({ userId, _id: { $ne: address._id } }, { isDefault: false });
  sendSuccess(res, address, "Address saved successfully", 201);
});

export const updateAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (req.body.isDefault) await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  Object.assign(address, req.body);
  await address.save();
  sendSuccess(res, address, "Address updated successfully");
});

export const deleteAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (address.isDefault) {
    const next = await Address.findOne({ userId: req.user!.id }).sort({ createdAt: -1 });
    if (next) { next.isDefault = true; await next.save(); }
  }
  sendSuccess(res, { id: req.params.id }, "Address removed successfully");
});

export const setDefaultAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  address.isDefault = true;
  await address.save();
  sendSuccess(res, address, "Default address updated");
});

// ============================================================
// CUSTOMER SECURITY CENTER (Feature 28)
// ============================================================
