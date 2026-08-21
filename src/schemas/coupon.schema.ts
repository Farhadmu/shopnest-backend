import { z } from "zod";

export const createCouponSchema = z.object({
  code: z.string().min(3).max(30).toUpperCase(),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  minPurchase: z.number().nonnegative().default(0),
  maxDiscount: z.number().positive().optional(),
  category: z.string().optional(),
  productId: z.string().optional(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional(),
});

export const applyCouponSchema = z.object({
  code: z.string().min(1),
});
