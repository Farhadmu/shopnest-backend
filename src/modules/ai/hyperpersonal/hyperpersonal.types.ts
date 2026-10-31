export type NextBestActionType =
  | "bundle_saver"
  | "restock_favorite"
  | "abandoned_cart_rescue"
  | "category_upgrade"
  | "loyalty_milestone"
  | "first_time_shopper";

export interface NextBestAction {
  actionId: string;
  actionType: NextBestActionType;
  headline: string;
  subtext: string;
  badge: string;
  urgency: "high" | "medium" | "low";
  recommendedProduct?: {
    id: string;
    title: string;
    price: number;
    discountPrice?: number;
    image: string;
    category: string;
  };
  incentiveVoucher?: {
    code: string;
    discountPercent: number;
    expiresHours: number;
  };
  ctaText: string;
  ctaLink: string;
}

export interface CustomerGenomeProfile {
  userId: string;
  customerName: string;
  archetype: string;
  aestheticStyles: string[];
  topCategoryAffinities: Array<{
    category: string;
    affinityScore: number; // 0 - 100
  }>;
  priceElasticity: "value_seeker" | "balanced" | "premium_buyer";
  journeyStage: "discovery" | "evaluation" | "intent" | "ready_to_buy" | "loyal_advocate";
  loyaltyScore: number; // 0 - 100
  estimatedNextOrderWindowDays: number;
  lifetimePurchasesCount: number;
  totalSpentFormatted: string;
  privacyShieldStatus: "Active (PII Obfuscated & Edge-Hashed)";
}

export interface SentimentAdaptiveResponse {
  detectedSentiment: "frustrated" | "hesitant" | "neutral" | "delighted";
  sentimentConfidence: number;
  adaptedTone: "empathetic_supportive" | "reassuring_clarifying" | "enthusiastic_guiding";
  replyMessage: string;
  specialIncentiveOffered?: {
    code: string;
    discountPercent: number;
    message: string;
  };
  recommendedProducts?: Array<{
    id: string;
    title: string;
    price: number;
    image: string;
  }>;
}

export interface CulturalContextualizedProduct {
  productId: string;
  region: string;
  culturalContextLabel: string;
  adaptedTitle: string;
  adaptedDescription: string;
  lifestyleUseCases: string[];
  regionalSavingsHighlight: string;
  recommendedComplements: string[];
}
