import { z } from "zod";

export const generateInvoiceSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  language: z.enum(["en", "bn"]).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
});

export const invoiceIdParamSchema = z.object({ orderId: z.string().min(1) });
