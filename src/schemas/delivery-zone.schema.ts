import { z } from "zod";

export const createDeliveryZoneSchema = z.object({
  name: z.string().trim().min(2, "Zone name is required").max(120),
  type: z.enum(["inside_dhaka", "outside_dhaka", "remote", "custom"]),
  divisions: z.array(z.string().trim().min(1)).min(1, "At least one division is required"),
  districts: z.array(z.string().trim().min(1)).min(1, "At least one district is required"),
  upazilas: z.array(z.string().trim().min(1)).optional(),
  estimatedDays: z.coerce.number().int().nonnegative("Estimated days must be 0 or more"),
  baseFee: z.coerce.number().nonnegative("Base fee must be 0 or more"),
  perKmFee: z.coerce.number().nonnegative("Per km fee must be 0 or more"),
  isActive: z.boolean().optional(),
});

export const updateDeliveryZoneSchema = createDeliveryZoneSchema.partial();

export const idParamSchema = z.object({ id: z.string().min(1) });
