import { Request, Response } from "express";
import { Coupon, computeDiscount } from "./coupon.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Controller: List Coupons (Seller / Admin)
 *
 * 1. Inputs Extracted:
 *    - req.user: Authenticated user role and id (sellers see only their coupons; admins see all)
 * 2. Database Operation:
 *    - Coupon.find(filter).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of coupons (Coupon[])
 */
export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const filter = req.user!.role === "admin" ? {} : { createdBy: req.user!.id };
  const coupons = await Coupon.find(filter).sort({ createdAt: -1 });
  res.status(200).json(coupons);
});

/**
 * Controller: Create New Coupon
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Creator user ID
 *    - req.body: code, type ("percentage" | "fixed"), value, minPurchase, maxDiscount, expiresAt, etc.
 * 2. Database Operation:
 *    - Coupon.findOne({ code }) to check uniqueness
 *    - Coupon.create(...) to save the coupon
 * 3. Response Sent:
 *    - HTTP 201: Created coupon JSON object with message "Coupon created"
 */
export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const exists = await Coupon.findOne({ code: req.body.code });
  if (exists) throw ApiError.conflict("Coupon code already exists");

  const coupon = await Coupon.create({ ...req.body, createdBy: req.user!.id });
  sendSuccess(res, coupon.toJSON(), "Coupon created", 201);
});

/**
 * Controller: Delete Coupon
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Coupon ID to delete
 * 2. Database Operation:
 *    - Coupon.findByIdAndDelete(id)
 * 3. Response Sent:
 *    - HTTP 200: { success: true } with message "Coupon deleted"
 */
export const deleteCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  sendSuccess(res, { success: true }, "Coupon deleted");
});

/**
 * Controller: Validate Coupon Code (Public / Checkout)
 *
 * 1. Inputs Extracted:
 *    - req.params.code: Coupon code string to validate
 *    - req.query.subtotal: Order subtotal number
 * 2. Database Operation:
 *    - Coupon.findOne({ code: code.toUpperCase() })
 *    - Computes discount using computeDiscount(coupon, subtotal)
 * 3. Response Sent:
 *    - HTTP 200: { code, discount, type, value }
 */
export const validateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const subtotal = Number(req.query.subtotal ?? 0);

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) throw ApiError.notFound("Invalid coupon code");

  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");

  sendSuccess(res, { code: coupon.code, discount, type: coupon.type, value: coupon.value });
});
