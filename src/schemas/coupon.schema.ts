import { z } from "zod";

export const createCouponSchema = z.object({
  code: z.string().min(3).max(30).toUpperCase(),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  minPurchase: z.number().nonnegative().default(0),
  maxDiscount: z.number().positive().optional(),

  scope: z.enum(["all-products", "specific-category", "specific-products"]).default("all-products"),
  category: z.string().optional(),
  categories: z.array(z.string()).optional(),
  productIds: z.array(z.string()).optional(),

  placement: z.enum(["store", "homepage", "private"]).default("store"),

  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),

  promoStartDate: z.coerce.date().optional(),
  durationDays: z.number().positive().max(60).optional(),

  usageLimit: z.number().int().positive().optional(),

  homepageStatus: z.enum(["running", "queued", "expired"]).optional(),
  queuePosition: z.number().int().nonnegative().optional(),
  approvedAt: z.coerce.date().optional(),
});

export const updateCouponSchema = createCouponSchema.partial();

export const rejectCouponSchema = z.object({
  rejectionNote: z.string().max(500).optional(),
});

export const reportCouponSchema = z.object({
  reportNote: z.string().min(1).max(500),
  rejectionNote: z.string().min(1).max(500).optional(),
});

export const applyCouponSchema = z.object({
  code: z.string().min(1),
});

export const approveCouponSchema = z.object({
  // Admin can optionally override duration/launch
  durationDays: z.number().positive().max(60).optional(),
  promoStartDate: z.coerce.date().optional(),
});
