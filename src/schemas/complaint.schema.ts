import { z } from "zod";

export const createComplaintSchema = z.object({
  title: z.string().min(1, "Subject is required").max(200),
  description: z.string().min(1, "Description is required").max(500, "Description must be 500 characters or fewer"),
  category: z.enum([
    "order",
    "payment",
    "product",
    "seller",
    "delivery",
    "refund",
    "return",
    "account",
    "technical",
    "other",
  ]),
  orderId: z.string().optional(),
  productId: z.string().optional(),
  deliveryId: z.string().optional(),
  sellerId: z.string().optional(),
  returnRequestId: z.string().optional(),
  reverseDeliveryRequestId: z.string().optional(),
});

export const complaintQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().optional(),
});
