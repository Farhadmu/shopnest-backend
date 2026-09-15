export enum CustomerCopilotIntent {
  GENERAL_CHAT = "GENERAL_CHAT",
  ORDER_STATUS = "ORDER_STATUS",
  ORDER_HISTORY = "ORDER_HISTORY",
  PRODUCT_DISCOVERY = "PRODUCT_DISCOVERY",
  PRODUCT_COMPARISON = "PRODUCT_COMPARISON",
  WISHLIST = "WISHLIST",
  CART = "CART",
  RECOMMENDATION = "RECOMMENDATION",
  REVIEW = "REVIEW",
  RETURN = "RETURN",
  REFUND = "REFUND",
  DEAL = "DEAL",
  NOTIFICATION = "NOTIFICATION",
  BUDGET = "BUDGET",
  SHOPPING_GOAL = "SHOPPING_GOAL",
  TRACKING = "TRACKING",
  UNKNOWN = "UNKNOWN",
}

export interface TimeRange {
  start: Date;
  end: Date;
  comparisonStart?: Date;
  comparisonEnd?: Date;
  label: string;
}

export interface CustomerCopilotMetric {
  label: string;
  value: number;
  formatted: string;
  changePercent?: number;
  trend?: "up" | "down" | "neutral";
}

export interface CustomerCopilotInsight {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  evidence?: Array<{ fact: string; value: string }>;
}

export interface CustomerCopilotSource {
  name: string;
  type: "database" | "analytics";
  recordCount?: number;
}

export interface CustomerCopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface CustomerCopilotResponse {
  answer: string;
  summary: string;
  intent: CustomerCopilotIntent;
  confidence: number;
  timeRange: TimeRange;
  metrics?: CustomerCopilotMetric[];
  insights?: CustomerCopilotInsight[];
  sources: CustomerCopilotSource[];
  suggestedActions?: CustomerCopilotAction[];
  isFallback: boolean;
  provider?: string;
  providerStatus?: "available" | "unavailable";
}

export interface CustomerCopilotQuery {
  query: string;
  role: "customer";
  context?: Record<string, unknown>;
}
