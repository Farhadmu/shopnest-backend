import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Coupon, ICoupon, computeDiscount } from "./coupon.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /coupons - sellers see their own coupons, admins see every coupon on the platform. */
export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const { placement, approvalStatus } = req.query as { placement?: string; approvalStatus?: string };

  const filter: FilterQuery<ICoupon> = req.user!.role === "admin" ? {} : { createdBy: req.user!.id };
  if (placement) filter.placement = placement;
  if (approvalStatus) filter.approvalStatus = approvalStatus;

  const coupons = await Coupon.find(filter).sort({ createdAt: -1 });
  res.status(200).json(coupons);
});

/**
 * POST /coupons - creates a coupon.
 *  - Admins: always auto-approved and live immediately (site-wide platform coupons).
 *  - Sellers, placement "store"/"private": auto-approved and live immediately.
 *  - Sellers, placement "homepage": goes in as "pending" and inactive until an
 *    admin approves it (see approveCoupon below).
 */
export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const exists = await Coupon.findOne({ code: req.body.code });
  if (exists) throw ApiError.conflict("Coupon code already exists");

  const role = req.user!.role as "seller" | "admin";
  const isHomepageRequest = role === "seller" && req.body.placement === "homepage";

  const coupon = await Coupon.create({
    ...req.body,
    createdBy: req.user!.id,
    createdByRole: role,
    approvalStatus: isHomepageRequest ? "pending" : "approved",
    isActive: !isHomepageRequest,
    approvedAt: isHomepageRequest ? undefined : new Date(),
  });

  sendSuccess(res, coupon.toJSON(), isHomepageRequest ? "Homepage request sent to admin" : "Coupon created", 201);
});

/** PATCH /coupons/:id/approve - admin only. Approves a pending homepage request and computes its live window. */
export const approveCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (coupon.placement !== "homepage") throw ApiError.badRequest("Only homepage requests need approval");

  const now = new Date();
  const startsAt = coupon.promoStartDate && coupon.promoStartDate > now ? coupon.promoStartDate : now;
  const durationDays = coupon.durationDays ?? 7;

  coupon.approvalStatus = "approved";
  coupon.rejectionNote = undefined;
  coupon.approvedAt = now;
  coupon.startsAt = startsAt;
  coupon.expiresAt = new Date(startsAt.getTime() + durationDays * DAY_MS);
  coupon.isActive = true;
  await coupon.save();

  sendSuccess(res, coupon.toJSON(), "Coupon approved and published to the homepage");
});

/** PATCH /coupons/:id/reject - admin only. Rejects a pending homepage request. */
export const rejectCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (coupon.placement !== "homepage") throw ApiError.badRequest("Only homepage requests can be rejected");

  coupon.approvalStatus = "rejected";
  coupon.isActive = false;
  coupon.rejectionNote = req.body?.rejectionNote;
  await coupon.save();

  sendSuccess(res, coupon.toJSON(), "Coupon rejected");
});

export const deleteCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (req.user!.role !== "admin" && coupon.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this coupon");
  }
  await coupon.deleteOne();
  sendSuccess(res, { success: true }, "Coupon deleted");
});

/** PUT /coupons/:id - seller/admin can update their own coupon (admin can update any). */
export const updateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (req.user!.role !== "admin" && coupon.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this coupon");
  }

  // If code changed, check uniqueness
  if (req.body.code && req.body.code !== coupon.code) {
    const exists = await Coupon.findOne({ code: req.body.code });
    if (exists) throw ApiError.conflict("Coupon code already exists");
  }

  const updatable = [
    "code", "type", "value", "minPurchase", "maxDiscount",
    "scope", "category", "categories", "productIds",
    "placement", "usageLimit", "startsAt", "expiresAt",
    "promoStartDate", "durationDays",
  ];
  for (const key of updatable) {
    if (req.body[key] !== undefined) {
      (coupon as any)[key] = req.body[key];
    }
  }

  // Re-evaluate approval if placement changed to homepage for seller
  if (req.user!.role === "seller" && coupon.placement === "homepage") {
    coupon.approvalStatus = "pending";
    coupon.isActive = false;
  }

  await coupon.save();
  sendSuccess(res, coupon.toJSON(), "Coupon updated");
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

/** GET /coupons/public/homepage - approved, currently-live homepage coupons for the marketplace homepage. */
export const getPublicHomepageCoupons = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const coupons = await Coupon.find({
    placement: "homepage",
    approvalStatus: "approved",
    isActive: true,
    $or: [{ startsAt: { $exists: false } }, { startsAt: { $lte: now } }],
    $and: [{ $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] }],
  }).sort({ approvedAt: -1 });

  res.status(200).json(coupons);
});

/** GET /coupons/public/store/:sellerId - approved, currently-live coupons for one seller's public store page. */
export const getPublicStoreCoupons = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const coupons = await Coupon.find({
    placement: "store",
    createdBy: req.params.sellerId,
    approvalStatus: "approved",
    isActive: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).sort({ createdAt: -1 });

  res.status(200).json(coupons);
});
