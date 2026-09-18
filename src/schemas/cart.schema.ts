import { z } from "zod";

export const addCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  variantName: z.string().optional(),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive(),
});

export const productIdParamSchema = z.object({ productId: z.string().min(1) });

/** Optional query param used to identify which variant of a product to update/remove */
export const variantQuerySchema = z.object({
  variantName: z.string().optional(),
});
