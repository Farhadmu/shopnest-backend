import { z } from "zod";

export const deliveryCopilotQuerySchema = z.object({
  query: z.string().min(1, "Query cannot be empty").max(1000, "Query is too long"),
  conversationMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      })
    )
    .optional(),
});
