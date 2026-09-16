export enum DeliveryCopilotIntent {
  ORDER_RECOMMENDATION = "ORDER_RECOMMENDATION",
  ACTIVE_WORKLOAD = "ACTIVE_WORKLOAD",
  DELIVERY_DIRECTIONS = "DELIVERY_DIRECTIONS",
  PRIORITY_ADVICE = "PRIORITY_ADVICE",
  INCIDENT_ADVICE = "INCIDENT_ADVICE",
  DAILY_SUMMARY = "DAILY_SUMMARY",
  CAPACITY_STATUS = "CAPACITY_STATUS",
  GENERAL_CHAT = "GENERAL_CHAT",
}

export interface TimeRange {
  start: Date;
  end: Date;
  label: string;
}

export interface DeliveryCopilotMetric {
  label: string;
  value: number;
  formatted: string;
  changePercent?: number;
  trend?: "up" | "down" | "neutral";
}

export interface DeliveryCopilotInsight {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  evidence?: Array<{ fact: string; value: string }>;
}

export interface DeliveryCopilotSource {
  name: string;
  type: "database" | "analytics";
  recordCount?: number;
}

export interface DeliveryCopilotAction {
  label: string;
  action: "navigate" | "filter" | "investigate";
  targetUrl?: string;
  description?: string;
}

export interface DeliveryCopilotResponse {
  answer: string;
  summary: string;
  intent: DeliveryCopilotIntent;
  confidence: number;
  timeRange: TimeRange;
  metrics?: DeliveryCopilotMetric[];
  insights?: DeliveryCopilotInsight[];
  sources: DeliveryCopilotSource[];
  suggestedActions?: DeliveryCopilotAction[];
  isFallback: boolean;
  provider?: string;
  providerStatus?: "available" | "unavailable";
}

export interface DeliveryCopilotQuery {
  query: string;
  role: "delivery_man";
  conversationMessages?: Array<{ role: string; content: string }>;
}
