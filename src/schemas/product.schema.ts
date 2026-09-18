import { z } from "zod";

export const productVariantSchema = z.object({
  name: z.string().min(1, "Variant name is required").trim(),
  sku: z.string().optional(),
  stock: z.coerce.number().int().nonnegative("Variant stock cannot be negative").optional().default(0),
  price: z.coerce.number().nonnegative("Variant price cannot be negative").optional(),
  color: z.string().optional(),
});

export const productHighlightSchema = z.union([
  z.object({
    title: z.string().min(1, "Highlight title is required").trim(),
    description: z.string().optional().default(""),
    icon: z.string().optional().default(""),
  }),
  z.string().min(1, "Highlight cannot be empty").trim().transform((title) => ({
    title,
    description: "",
    icon: "",
  })),
]);

function hasUniqueVariantNames(variants?: Array<{ name: string }>): boolean {
  if (!variants || variants.length <= 1) return true;
  const names = new Set<string>();
  for (const v of variants) {
    const lower = (v.name || "").trim().toLowerCase();
    if (names.has(lower)) return false;
    names.add(lower);
  }
  return true;
}

export const createProductBaseSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().min(1, "Description is required"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  category: z.string().min(1, "Category is required"),
  stock: z.coerce.number().int().nonnegative("Stock cannot be negative").default(0),
  images: z.array(z.string()).optional().default([]),
  discountPrice: z.coerce.number().nonnegative().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  specifications: z.record(z.string(), z.any()).optional().default({}),
  variants: z.array(productVariantSchema).optional().default([]),
  highlights: z.array(productHighlightSchema).optional().default([]),
  packageContents: z.array(z.string().trim()).optional().default([]),
  isFeatured: z.boolean().optional().default(false),
});

export const createProductSchema = createProductBaseSchema.refine(
  (data) => hasUniqueVariantNames(data.variants),
  {
    message: "Duplicate variant names are not allowed",
    path: ["variants"],
  }
);

export const updateProductSchema = createProductBaseSchema.partial().refine(
  (data) => hasUniqueVariantNames(data.variants),
  {
    message: "Duplicate variant names are not allowed",
    path: ["variants"],
  }
);

export const updateFeaturedSchema = z.object({
  isFeatured: z.boolean({ required_error: "isFeatured is required" }),
});

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
  isFeatured: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating", "popular", "featured"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

/**
 * Query for the category counts endpoint: the same filters as the product list
 * minus paging/sorting, which don't affect counts.
 */
export const productCountsQuerySchema = listProductsQuerySchema.omit({
  page: true,
  limit: true,
  sort: true,
});

export const idParamSchema = z.object({ id: z.string().min(1) });
