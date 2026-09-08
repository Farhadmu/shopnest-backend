import { z } from "zod";

export const aiChatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
});

export const aiRecommendSchema = z.object({
  query: z.string().min(1).max(500).optional(),
  budgetMax: z.number().positive().optional(),
  category: z.string().optional(),
});

export const aiDescriptionSchema = z.object({
  productName: z.string().min(2).max(200),
  category: z.string().min(1),
  features: z.array(z.string()).min(1, "Provide at least one feature"),
});

export const aiReviewSummarySchema = z.object({
  productId: z.string().min(1),
});

export const aiCompareSchema = z.object({
  productIds: z.array(z.string().min(1)).min(2, "Select at least 2 products").max(5),
});

export const aiPricingSchema = z.object({
  productId: z.string().min(1),
});

export const aiVisualSearchSchema = z.object({
  imageUrl: z.string().url(),
});
