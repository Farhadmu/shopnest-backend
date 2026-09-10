import { z } from "zod";

export const createHeroBannerSchema = z.object({
  categoryId: z.string().min(1, "Category is required").nullable().optional(),
  placement: z.enum(["hero", "side", "bottom"]).default("hero"),
  imageUrl: z
    .string()
    .refine((value) => value.startsWith("/") || URL.canParse(value), "A valid image URL or site path is required"),
  eyebrow: z.string().max(100).optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  highlight: z.string().max(100).optional().nullable(),
  subtitle: z.string().max(300).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  price: z.string().max(50).optional().nullable(),
  buttonText: z.string().max(80).optional().nullable(),
  targetUrl: z
    .string()
    .refine((value) => value.startsWith("/") || URL.canParse(value), "A valid URL or site path is required")
    .optional()
    .nullable(),
  overlayColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Overlay color must be a hex color").optional().nullable(),
  overlayOpacity: z.coerce.number().int().min(0).max(100).optional().nullable(),
  bgClassName: z.string().max(200).optional().nullable(),
  textTheme: z.enum(["light", "dark"]).default("light"),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().nonnegative().default(0),
});

export const updateHeroBannerSchema = createHeroBannerSchema.partial();

export const reorderHeroBannersSchema = z.object({
  bannerIds: z.array(z.string().min(1)).min(1, "At least one banner id is required"),
});

export const heroBannerQuerySchema = z.object({
  category_id: z.string().optional(),
  placement: z.enum(["hero", "side", "bottom"]).optional(),
});
