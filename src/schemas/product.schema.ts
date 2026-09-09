import { z } from "zod";

export const createProductSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().min(1, "Description is required"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  category: z.string().min(1, "Category is required"),
  stock: z.coerce.number().int().nonnegative("Stock cannot be negative").default(0),
  images: z.array(z.string()).optional().default([]),
  discountPrice: z.coerce.number().nonnegative().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  specifications: z.record(z.string(), z.any()).optional().default({}),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  search: z.string().optional(),
  category: z.string().optional(),
  storeId: z.string().optional(),
  store: z.string().optional(),
  sellerId: z.string().optional(),
  seller: z.string().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  productRating: z.coerce.number().min(0).max(5).optional(),
  verified: z.string().optional(),
  inStock: z.string().optional(),
  freeDelivery: z.string().optional(),
  aiPick: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating", "popular"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const idParamSchema = z.object({ id: z.string().min(1) });
