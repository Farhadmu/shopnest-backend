import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(120).optional(),
  parent: z.preprocess((value) => (value === "" || value === "null" ? null : value), z.string().nullable().optional()),
  image: z.string().url().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const categoryLockSchema = z.object({
  is_locked: z.boolean(),
  assigned_seller_id: z.string().nullable().optional(),
  lockedAt: z.coerce.date().nullable().optional(),
});

export const categoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  parent: z.string().nullable().optional(),
  image: z.string().optional(),
  is_locked: z.boolean(),
  assigned_seller_id: z.string().nullable().optional(),
  lockedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CategoryResponse = z.infer<typeof categoryResponseSchema>;