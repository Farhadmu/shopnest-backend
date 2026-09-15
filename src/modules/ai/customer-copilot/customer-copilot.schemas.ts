import { z } from "zod";

export const customerCopilotQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
});

export type CustomerCopilotQueryInput = z.infer<typeof customerCopilotQuerySchema>;
