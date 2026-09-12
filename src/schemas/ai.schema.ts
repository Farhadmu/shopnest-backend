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

export const aiAnalyzeImagesSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1, "Provide at least one image URL").max(5, "Maximum 5 images allowed"),
  hints: z.object({ productName: z.string().optional(), category: z.string().optional(), notes: z.string().optional() }).optional(),
});

export const aiGenerateProductSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1, "Provide at least one image URL").max(5, "Maximum 5 images allowed"),
  analysis: z.record(z.string(), z.any()).optional(),
  hints: z.object({ productName: z.string().optional(), category: z.string().optional(), costPrice: z.string().optional(), targetCustomer: z.string().optional(), specialFeatures: z.string().optional(), notes: z.string().optional() }).optional(),
});

export const aiTranslateSchema = z.object({
  sections: z.record(z.string(), z.string()),
  targetLanguage: z.enum(["bn", "en"]),
});

export const aiSuggestPriceSchema = z.object({
  category: z.string().optional(),
  costPrice: z.number().positive().optional(),
});

export const aiProductFinderSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1, "Upload at least one image").max(5, "Maximum 5 images allowed"),
  hints: z.object({ productName: z.string().optional(), category: z.string().optional(), notes: z.string().optional(), targetCustomer: z.string().optional(), specialFeatures: z.string().optional() }).optional(),
});
