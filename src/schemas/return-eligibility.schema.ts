import { z } from "zod";

export const eligibilityParamsSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  productId: z.string().min(1, "Product ID is required"),
});

export const checkReturnEligibilitySchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  productId: z.string().min(1, "Product ID is required"),
});

export const bulkCheckEligibilitySchema = z.object({
  checks: z.array(checkReturnEligibilitySchema).min(1, "At least one check is required").max(50, "Maximum 50 checks per request"),
});
