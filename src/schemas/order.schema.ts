import { z } from "zod";

export const createOrderSchema = z.object({
  shippingAddress: z.string().min(5, "Shipping address is required"),
  division: z.string().min(1, "Division is required"),
  paymentMethod: z.enum(["cod", "card", "stripe", "bkash", "nagad"]).or(z.string().min(1)),
  couponCode: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "returned",
    "refunded",
  ]),
});
