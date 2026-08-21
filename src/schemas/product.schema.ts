import { z } from "zod";

export const createProductSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().min(10, "Description must be at least 10 characters"),
  price: z.number().positive("Price must be greater than 0"),
  category: z.string().min(1, "Category is required"),
  stock: z.number().int().nonnegative("Stock cannot be negative"),
  images: z.array(z.string().url()).optional(),
  discountPrice: z.number().positive().optional(),
  tags: z.array(z.string()).optional(),
  specifications: z.record(z.string(), z.string()).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  storeId: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating", "popular"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const idParamSchema = z.object({ id: z.string().min(1) });
