import { z } from "zod";

export const createCourierSchema = z.object({
  name: z.string().trim().min(2, "Courier name is required").max(120),
  logo: z.string().url().optional(),
  trackingUrl: z.string().url().optional(),
  coverageAreas: z.array(z.object({
    zoneType: z.string().trim().min(1),
    estimatedDays: z.coerce.number().int().nonnegative(),
    rateStructure: z.array(z.object({
      weightRange: z.string().trim().min(1),
      price: z.coerce.number().nonnegative(),
    })),
  })).min(1, "At least one coverage area is required"),
  rateStructure: z.array(z.object({
    weightRange: z.string().trim().min(1),
    price: z.coerce.number().nonnegative(),
  })).min(1, "At least one rate item is required"),
  estimatedDays: z.coerce.number().int().nonnegative(),
  isActive: z.boolean().optional(),
});

export const updateCourierSchema = createCourierSchema.partial();

export const compareCouriersQuerySchema = z.object({
  destinationDistrict: z.string().trim().min(1, "Destination district is required"),
  destinationDivision: z.string().trim().min(1, "Destination division is required"),
  weight: z.coerce.number().positive("Weight must be greater than 0").optional(),
});
