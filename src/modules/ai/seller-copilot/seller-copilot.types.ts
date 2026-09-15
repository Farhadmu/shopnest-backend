export enum SellerCopilotIntent {
  STORE_OVERVIEW = "STORE_OVERVIEW",
  REVENUE_ANALYSIS = "REVENUE_ANALYSIS",
  SALES_ANALYSIS = "SALES_ANALYSIS",
  ORDER_ANALYSIS = "ORDER_ANALYSIS",
  PRODUCT_ANALYSIS = "PRODUCT_ANALYSIS",
  INVENTORY_ANALYSIS = "INVENTORY_ANALYSIS",
  CUSTOMER_ANALYSIS = "CUSTOMER_ANALYSIS",
  REVIEW_ANALYSIS = "REVIEW_ANALYSIS",
  RETURN_ANALYSIS = "RETURN_ANALYSIS",
  CATEGORY_ANALYSIS = "CATEGORY_ANALYSIS",
  FORECAST_ANALYSIS = "FORECAST_ANALYSIS",
  RECOMMENDATION = "RECOMMENDATION",
  ROOT_CAUSE_ANALYSIS = "ROOT_CAUSE_ANALYSIS",
  COMPARISON = "COMPARISON",
  TREND_ANALYSIS = "TREND_ANALYSIS",
  GENERAL_QUESTION = "GENERAL_QUESTION",
  UNKNOWN = "UNKNOWN",
}

export interface TimeRange {
  start: Date;
  end: Date;
  comparisonStart?: Date;
  comparisonEnd?: Date;
  label: string;
}

export interface SellerCopilotMetric {
  label: string;
  value: number;
  formatted: string;
  changePercent?: number;
  trend?: "up" | "down" | "neutral";
}

export interface SellerCopilotInsight {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  evidence?: Array<{ fact: string; value: string }>;
}

export interface SellerCopilotSource {
  name: string;
  type: "database" | "analytics";
  recordCount?: number;
}

export interface SellerCopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface SellerCopilotResponse {
  answer: string;
  summary: string;
  intent: SellerCopilotIntent;
  confidence: number;
  timeRange: TimeRange;
  metrics?: SellerCopilotMetric[];
  insights?: SellerCopilotInsight[];
  sources: SellerCopilotSource[];
  suggestedActions?: SellerCopilotAction[];
  isFallback: boolean;
  provider?: string;
  providerStatus?: "available" | "unavailable";
}

export interface SellerCopilotQuery {
  query: string;
  role: "seller";
  context?: Record<string, unknown>;
}
