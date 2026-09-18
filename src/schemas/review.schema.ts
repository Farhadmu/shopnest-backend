import { z } from "zod";

export const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().optional(),
  comment: z.string().min(3).max(2000),
  images: z.array(z.string()).optional(),
});
