import { z } from "zod";

export const adminCopilotQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  context: z.record(z.unknown()).optional(),
});

export type AdminCopilotQueryInput = z.infer<typeof adminCopilotQuerySchema>;
