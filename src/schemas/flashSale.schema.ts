import { z } from "zod";

export const createFlashSaleSchema = z
  .object({
    title: z.string().min(3).max(120),
    productIds: z.array(z.string().min(1)).min(1, "Select at least one product"),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.number().positive(),
    productLimit: z.number().int().positive().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
