import { Request, Response } from "express";
import { Coupon, computeDiscount } from "./coupon.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const filter = req.user!.role === "admin" ? {} : { createdBy: req.user!.id };
  const coupons = await Coupon.find(filter).sort({ createdAt: -1 });
  res.status(200).json(coupons);
});

export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const exists = await Coupon.findOne({ code: req.body.code });
  if (exists) throw ApiError.conflict("Coupon code already exists");
  const coupon = await Coupon.create({ ...req.body, createdBy: req.user!.id });
  sendSuccess(res, coupon.toJSON(), "Coupon created", 201);
});

export const deleteCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  sendSuccess(res, { success: true }, "Coupon deleted");
});

export const validateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const subtotal = Number(req.query.subtotal ?? 0);

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) throw ApiError.notFound("Invalid coupon code");

  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");

  sendSuccess(res, { code: coupon.code, discount, type: coupon.type, value: coupon.value });
});
