export enum CopilotIntent {
  MARKETPLACE_OVERVIEW = "MARKETPLACE_OVERVIEW",
  REVENUE_ANALYSIS = "REVENUE_ANALYSIS",
  GMV_ANALYSIS = "GMV_ANALYSIS",
  ORDER_ANALYSIS = "ORDER_ANALYSIS",
  CUSTOMER_ANALYSIS = "CUSTOMER_ANALYSIS",
  SELLER_ANALYSIS = "SELLER_ANALYSIS",
  SELLER_RISK = "SELLER_RISK",
  PRODUCT_ANALYSIS = "PRODUCT_ANALYSIS",
  CATEGORY_ANALYSIS = "CATEGORY_ANALYSIS",
  ANOMALY_ANALYSIS = "ANOMALY_ANALYSIS",
  REVENUE_LEAKAGE = "REVENUE_LEAKAGE",
  FRAUD_ANALYSIS = "FRAUD_ANALYSIS",
  SECURITY_ANALYSIS = "SECURITY_ANALYSIS",
  SYSTEM_HEALTH = "SYSTEM_HEALTH",
  TELEMETRY_ANALYSIS = "TELEMETRY_ANALYSIS",
  FORECAST_ANALYSIS = "FORECAST_ANALYSIS",
  GROWTH_ANALYSIS = "GROWTH_ANALYSIS",
  COUPON_ANALYSIS = "COUPON_ANALYSIS",
  REFUND_ANALYSIS = "REFUND_ANALYSIS",
  CANCELLATION_ANALYSIS = "CANCELLATION_ANALYSIS",
  DELIVERY_ANALYSIS = "DELIVERY_ANALYSIS",
  INVENTORY_ANALYSIS = "INVENTORY_ANALYSIS",
  REVIEW_ANALYSIS = "REVIEW_ANALYSIS",
  PLATFORM_PERFORMANCE = "PLATFORM_PERFORMANCE",
  GEOGRAPHICAL_ANALYSIS = "GEOGRAPHICAL_ANALYSIS",
  TREND_ANALYSIS = "TREND_ANALYSIS",
  COMPARISON = "COMPARISON",
  ROOT_CAUSE_ANALYSIS = "ROOT_CAUSE_ANALYSIS",
  RECOMMENDATION = "RECOMMENDATION",
  EXECUTIVE_SUMMARY = "EXECUTIVE_SUMMARY",
  PRIORITY_ACTIONS = "PRIORITY_ACTIONS",
  UNKNOWN = "UNKNOWN",
}

export interface TimeRange {
  start: Date;
  end: Date;
  comparisonStart?: Date;
  comparisonEnd?: Date;
  label: string;
}

export interface CopilotMetric {
  label: string;
  value: number;
  formatted: string;
  changePercent?: number;
  trend?: "up" | "down" | "stable";
}

export interface CopilotEvidence {
  fact: string;
  value?: string | number;
  source?: string;
}

export interface CopilotInsight {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  evidence?: CopilotEvidence[];
}

export interface CopilotSource {
  name: string;
  type: "database" | "analytics" | "security" | "forecast" | "telemetry";
  period?: string;
}

export interface CopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface CopilotResponse {
  answer: string;
  summary: string;
  intent: CopilotIntent;
  confidence: number;
  timeRange: TimeRange;
  metrics?: CopilotMetric[];
  insights?: CopilotInsight[];
  sources: CopilotSource[];
  suggestedActions?: CopilotAction[];
  isFallback: boolean;
}

export interface CopilotQuery {
  query: string;
  role: "admin";
  context?: Record<string, unknown>;
}

export interface AdminCopilotContext {
  intent: CopilotIntent;
  timeRange: TimeRange;
  tools: string[];
  data: Record<string, unknown>;
}
