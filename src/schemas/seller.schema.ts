import { z } from "zod";

export const registerStoreSchema = z.object({
  storeName: z.string().min(2).max(150),
  description: z.string().min(10).max(2000),
  logo: z.string().optional(),
  banner: z.string().optional(),
  businessInfo: z
    .object({
      ownerName: z.string().min(2).optional(),
      contactPhone: z.string().min(5).optional(),
      businessAddress: z.string().min(3).optional(),
      nidOrTradeLicense: z.string().optional(),
      taxId: z.string().optional(),
      category: z.string().optional(),
      payoutMethod: z.string().optional(),
      payoutAccountNumber: z.string().optional(),
      payoutAccountName: z.string().optional(),
      bankBranch: z.string().optional(),
    })
    .optional(),
});

export const updateStoreSchema = registerStoreSchema.partial();

