import { z } from "zod";

export const customerCopilotQuerySchema = z.object({
  query: z.string().min(1, "Query is required").max(2000, "Query cannot exceed 2000 characters"),
  context: z.record(z.unknown()).optional(),
  conversationId: z.string().optional(),
});

export type CustomerCopilotQueryInput = z.infer<typeof customerCopilotQuerySchema>;
