import { z } from "zod";

export const assessOrderRiskSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
});

export const riskOrderIdParamSchema = z.object({ orderId: z.string().min(1) });
