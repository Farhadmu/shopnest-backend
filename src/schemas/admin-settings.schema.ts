import { z } from "zod";

export const updateAdminSettingsSchema = z.object({
  category_length: z.number().int().positive().max(1000),
});

export const adminSettingsResponseSchema = z.object({
  id: z.string(),
  category_length: z.number().int().positive(),
  lockedCategoriesCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;
