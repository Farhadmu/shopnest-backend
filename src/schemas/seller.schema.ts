import { z } from "zod";

export const registerStoreSchema = z.object({
  storeName: z.string().min(2).max(150),
  description: z.string().min(10).max(2000),
  logo: z.string().url().optional(),
  banner: z.string().url().optional(),
  businessInfo: z
    .object({
      ownerName: z.string().min(2),
      contactPhone: z.string().min(6),
      businessAddress: z.string().min(5),
    })
    .optional(),
});

export const updateStoreSchema = registerStoreSchema.partial();
