import { z } from "zod";

export const sellerCopilotQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
});

export type SellerCopilotQueryInput = z.infer<typeof sellerCopilotQuerySchema>;
