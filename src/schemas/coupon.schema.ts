import { z } from "zod";

const baseCouponSchema = z.object({
  code: z.string().min(3).max(30).toUpperCase(),
  type: z.enum(["percentage", "fixed", "free-shipping"]),
  // "free-shipping" coupons don't use value for discount math — the form always
  // submits 0 for this type, so 0 is accepted here (not made optional); the
  // superRefine below still requires a positive value for percentage/fixed.
  value: z.number().nonnegative(),
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

function requirePositiveValueUnlessFreeShipping(
  data: { type: string; value: number },
  ctx: z.RefinementCtx
) {
  if (data.type !== "free-shipping" && data.value <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "value must be greater than 0",
    });
  }
}

export const createCouponSchema = baseCouponSchema.superRefine(requirePositiveValueUnlessFreeShipping);

export const updateCouponSchema = baseCouponSchema.partial().superRefine((data, ctx) => {
  if (data.type === undefined || data.value === undefined) return;
  requirePositiveValueUnlessFreeShipping({ type: data.type, value: data.value }, ctx);
});

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
