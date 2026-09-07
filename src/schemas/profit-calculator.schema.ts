import { z } from "zod";

export const calculateProfitSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
  productCost: z.coerce.number().nonnegative("Product cost must be 0 or more"),
  deliveryCost: z.coerce.number().nonnegative("Delivery cost must be 0 or more"),
  platformFee: z.coerce.number().nonnegative("Platform fee must be 0 or more"),
  discount: z.coerce.number().nonnegative("Discount must be 0 or more").default(0),
});
