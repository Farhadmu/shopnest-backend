import { z } from "zod";

export const createSupportTicketSchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(3, "Subject is required").max(180),
  message: z.string().trim().min(10, "Please provide a little more detail").max(4000),
});
