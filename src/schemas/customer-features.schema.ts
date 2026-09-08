import { z } from "zod";

// Advanced AI Search schema
export const advancedSearchSchema = z.object({
  q: z.string().min(1).max(500),
  category: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  brand: z.string().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  seller: z.string().optional(),
  availability: z.enum(["in_stock", "out_of_stock"]).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating", "popular", "newest"]).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});

// Gift Finder schema
export const giftFinderSchema = z.object({
  occasion: z.string().max(100).optional(),
  relationship: z.string().max(50).optional(),
  ageRange: z.string().max(20).optional(),
  budget: z.number().positive(),
  interests: z.string().max(200).optional(),
  gender: z.string().max(20).optional(),
});

// Review Draft schema
export const reviewDraftSchema = z.object({
  productId: z.string().min(1),
  quality: z.number().min(1).max(5).optional(),
  delivery: z.number().min(1).max(5).optional(),
  packaging: z.number().min(1).max(5).optional(),
  value: z.number().min(1).max(5).optional(),
  overallExperience: z.string().max(500).optional(),
});

// Deal Finder schema
export const dealFinderSchema = z.object({
  budget: z.number().positive(),
  category: z.string().max(100).optional(),
  purpose: z.string().max(100).optional(),
  features: z.string().max(300).optional(),
});

// Return Request schema
export const createReturnSchema = z.object({
  orderId: z.string().min(1),
  productId: z.string().min(1),
  type: z.enum(["return", "refund", "replacement"]),
  reason: z.string().min(10).max(1000),
  evidenceUrls: z.array(z.string().url()).optional(),
});

// Voucher Claim schema
export const claimVoucherSchema = z.object({
  couponCode: z.string().min(3).max(30),
});

// Communication schema
export const sendMessageSchema = z.object({
  receiverId: z.string().min(1),
  orderId: z.string().optional(),
  productId: z.string().optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
});

export const reportMessageSchema = z.object({
  reason: z.string().min(1).max(500),
});

// AI Support schema
export const aiSupportSchema = z.object({
  message: z.string().min(1).max(2000),
});

// Loyalty Redeem schema
export const redeemPointsSchema = z.object({
  points: z.number().positive(),
  rewardType: z.enum(["coupon", "free_delivery", "discount"]),
});

// Address Intelligent schema
export const createAddressIntelligentSchema = z.object({
  title: z.string().max(50).default("Home"),
  fullName: z.string().min(2).max(100),
  phone: z.string().min(11).max(15),
  division: z.string().min(2).max(50),
  district: z.string().min(2).max(50),
  upazila: z.string().max(50).optional().default(""),
  city: z.string().max(50).optional().default(""),
  streetAddress: z.string().min(5).max(200),
  postalCode: z.string().max(10).optional().default(""),
  addressType: z.enum(["home", "office", "university", "other"]).default("home"),
  isDefault: z.boolean().optional(),
});

export const updateAddressIntelligentSchema = createAddressIntelligentSchema.partial();

// Change Password schema
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6).max(100),
  newPassword: z.string().min(6).max(100),
});

// Shopping Profile schema
export const updateShoppingProfileSchema = z.object({
  preferredCategories: z.array(z.string()).max(20).optional(),
  typicalBudgetMin: z.number().min(0).optional(),
  typicalBudgetMax: z.number().min(0).optional(),
  preferredSellers: z.array(z.string()).max(10).optional(),
  preferredDelivery: z.enum(["standard", "express", "any"]).optional(),
  favoriteBrands: z.array(z.string()).max(20).optional(),
  shoppingInterests: z.array(z.string()).max(20).optional(),
  allowPersonalization: z.boolean().optional(),
});
