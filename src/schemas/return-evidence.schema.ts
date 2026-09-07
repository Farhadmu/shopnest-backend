import { z } from "zod";

export const submitReturnEvidenceSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  productId: z.string().min(1, "Product ID is required"),
  images: z.array(z.string().url()).min(1, "At least one image is required"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(2000),
  issueType: z.enum(["wrong_item", "damaged", "defective", "not_as_described", "size_issue", "missing_parts", "other"]),
  videos: z.array(z.string().url()).optional(),
});

export const returnIdParamSchema = z.object({ returnId: z.string().min(1) });
export const orderIdParamSchema = z.object({ orderId: z.string().min(1) });
