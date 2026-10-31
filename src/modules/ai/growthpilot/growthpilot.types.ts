export type MarketingChannel =
  | "instagram_reels"
  | "facebook_ads"
  | "linkedin_b2b"
  | "seo_blog"
  | "email_drip";

export interface GeneratedCampaign {
  channel: MarketingChannel;
  channelLabel: string;
  headline: string;
  primaryText: string;
  hookScript?: string;
  callToAction: string;
  hashtags: string[];
  targetAudience: string;
  projectedMetrics: {
    estimatedCac: string;
    projectedCtr: string;
    conversionLift: string;
  };
}

export interface ChurnRiskCustomer {
  customerId: string;
  name: string;
  email: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDaysAgo: number;
  cartItemCount: number;
  churnProbability: number; // 0.0 - 1.0
  riskTier: "critical" | "high" | "medium";
  recommendedDiscountPercent: number; // dynamically bounded to protect margin
  maxSafeDiscountPercent: number;
  projectedRecoveryProbability: number;
  recommendedIncentiveMessage: string;
}

export interface DynamicValueProp {
  referralSource: "google_search" | "facebook_ad" | "tiktok_viral" | "linkedin_b2b" | "direct";
  sourceLabel: string;
  visitorPersona: string;
  adaptedHeadline: string;
  adaptedSubheadline: string;
  urgencyBadge: string;
  personalizedOfferText: string;
  conversionBenefit: string;
}

export interface GrowthPilotOverview {
  storeName: string;
  estimatedCacReductionPercent: number;
  projectedConversionRateLiftPercent: number;
  totalAtRiskRevenue: number;
  highRiskChurnCount: number;
  totalCustomerLeadsScored: number;
  churnSegments: {
    critical: number;
    high: number;
    medium: number;
  };
  topProducts: Array<{
    id: string;
    title: string;
    category: string;
    price: number;
    discountPrice?: number;
    stock: number;
    sold: number;
    image?: string;
  }>;
  atRiskCustomers: ChurnRiskCustomer[];
  leadScoringQueue: Array<{
    customerId: string;
    name: string;
    email: string;
    intentScore: number; // 0 - 100
    intentStage: "Hot Prospect" | "Warm Shopper" | "Cold / At-Risk";
    favoriteCategory: string;
    recommendedAction: string;
  }>;
}
