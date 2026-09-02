import { CopilotIntent, TimeRange } from "./admin-copilot.types";

interface DetectedIntent {
  intent: CopilotIntent;
  confidence: number;
  keywords: string[];
}

const INTENT_PATTERNS: Array<{ intent: CopilotIntent; patterns: string[] }> = [
  { intent: CopilotIntent.EXECUTIVE_SUMMARY, patterns: ["executive briefing", "executive summary", "complete summary", "full briefing", "today's briefing", "daily briefing", "marketplace briefing", "give me a complete", "full report", "comprehensive overview"] },
  { intent: CopilotIntent.PRIORITY_ACTIONS, patterns: ["what should i do", "what to do", "prioritize", "priority", "top priority", "what needs attention", "investigate first", "biggest risk", "most urgent", "action items"] },
  { intent: CopilotIntent.REVENUE_ANALYSIS, patterns: ["revenue", "earning", "income", "profit", "money made", "how much revenue", "revenue growth", "revenue decline", "revenue drop"] },
  { intent: CopilotIntent.GMV_ANALYSIS, patterns: ["gmv", "gross merchandise", "total sales value", "transaction volume"] },
  { intent: CopilotIntent.ORDER_ANALYSIS, patterns: ["orders", "order count", "order volume", "order growth", "order trend"] },
  { intent: CopilotIntent.CUSTOMER_ANALYSIS, patterns: ["customer", "user", "shopper", "buyer", "customer growth", "active users"] },
  { intent: CopilotIntent.SELLER_ANALYSIS, patterns: ["seller", "merchant", "vendor", "store", "best seller", "top seller", "seller performance"] },
  { intent: CopilotIntent.SELLER_RISK, patterns: ["risky seller", "high risk", "seller risk", "risky merchant", "dangerous seller", "problematic seller"] },
  { intent: CopilotIntent.PRODUCT_ANALYSIS, patterns: ["product", "item", "best selling", "top product", "product performance"] },
  { intent: CopilotIntent.CATEGORY_ANALYSIS, patterns: ["category", "categories", "which category", "category growth", "category revenue", "electronics", "fashion", "grocery"] },
  { intent: CopilotIntent.ANOMALY_ANALYSIS, patterns: ["anomaly", "anomalies", "unusual", "abnormal", "suspicious pattern", "flagged"] },
  { intent: CopilotIntent.REVENUE_LEAKAGE, patterns: ["leakage", "revenue leak", "losing money", "money leak", "financial leak", "where are we losing"] },
  { intent: CopilotIntent.FRAUD_ANALYSIS, patterns: ["fraud", "scam", "fake", "suspicious order", "suspicious transaction", "fraudulent"] },
  { intent: CopilotIntent.SECURITY_ANALYSIS, patterns: ["security", "security incident", "security issue", "breach", "hack", "suspicious login"] },
  { intent: CopilotIntent.SYSTEM_HEALTH, patterns: ["system health", "platform health", "is the platform healthy", "api health", "system status"] },
  { intent: CopilotIntent.TELEMETRY_ANALYSIS, patterns: ["telemetry", "api performance", "response time", "error rate", "slow endpoint", "degraded"] },
  { intent: CopilotIntent.FORECAST_ANALYSIS, patterns: ["forecast", "predict", "projection", "future", "next month", "next week", "will grow"] },
  { intent: CopilotIntent.GROWTH_ANALYSIS, patterns: ["growth", "growing", "growing fastest", "declining", "growth rate"] },
  { intent: CopilotIntent.COUPON_ANALYSIS, patterns: ["coupon", "discount code", "promo", "voucher", "coupon abuse"] },
  { intent: CopilotIntent.REFUND_ANALYSIS, patterns: ["refund", "refund rate", "refund abuse", "too many refunds"] },
  { intent: CopilotIntent.CANCELLATION_ANALYSIS, patterns: ["cancel", "cancellation", "cancelled", "cancellation rate"] },
  { intent: CopilotIntent.DELIVERY_ANALYSIS, patterns: ["delivery", "shipping", "courier", "delayed", "delivery performance"] },
  { intent: CopilotIntent.INVENTORY_ANALYSIS, patterns: ["inventory", "stock", "low stock", "out of stock", "running out"] },
  { intent: CopilotIntent.REVIEW_ANALYSIS, patterns: ["review", "rating", "feedback", "negative review", "complaint"] },
  { intent: CopilotIntent.GEOGRAPHICAL_ANALYSIS, patterns: ["geographic", "location", "region", "district", "division", "area", "map"] },
  { intent: CopilotIntent.TREND_ANALYSIS, patterns: ["trend", "trending", "over time", "pattern", "historical"] },
  { intent: CopilotIntent.COMPARISON, patterns: ["compare", "comparison", "versus", "vs", "difference between", "this month vs last"] },
  { intent: CopilotIntent.ROOT_CAUSE_ANALYSIS, patterns: ["why", "reason", "cause", "root cause", "what caused", "why did", "why is"] },
  { intent: CopilotIntent.RECOMMENDATION, patterns: ["recommend", "suggestion", "advice", "what should", "best action"] },
  { intent: CopilotIntent.MARKETPLACE_OVERVIEW, patterns: ["overview", "summary", "how is the marketplace", "marketplace status", "platform status", "dashboard", "snapshot"] },
  { intent: CopilotIntent.PLATFORM_PERFORMANCE, patterns: ["performance", "how are we doing", "platform metrics", "kpi"] },
];

export function detectIntent(query: string): DetectedIntent {
  const normalizedQuery = query.toLowerCase().trim();

  let bestMatch: DetectedIntent = { intent: CopilotIntent.UNKNOWN, confidence: 0, keywords: [] };

  for (const { intent, patterns } of INTENT_PATTERNS) {
    const matchedPatterns = patterns.filter((p) => normalizedQuery.includes(p));
    if (matchedPatterns.length > 0) {
      const confidence = Math.min(matchedPatterns.length / patterns.length + 0.5, 1);
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent, confidence, keywords: matchedPatterns };
      }
    }
  }

  if (bestMatch.intent === CopilotIntent.UNKNOWN) {
    if (normalizedQuery.includes("?") || normalizedQuery.length > 10) {
      return { intent: CopilotIntent.MARKETPLACE_OVERVIEW, confidence: 0.3, keywords: [] };
    }
  }

  return bestMatch;
}

export function detectTimeRange(query: string): TimeRange {
  const now = new Date();
  const normalizedQuery = query.toLowerCase();

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endOfLastWeek = new Date(startOfWeek.getTime() - 1);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

  if (normalizedQuery.includes("today") || normalizedQuery.includes("24 hours") || normalizedQuery.includes("last 24")) {
    return { start: startOfDay, end: endOfDay, label: "today" };
  }
  if (normalizedQuery.includes("yesterday")) {
    const yesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
    return { start: yesterday, end: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1), label: "yesterday" };
  }
  if (normalizedQuery.includes("this week")) {
    return { start: startOfWeek, end: endOfWeek, comparisonStart: startOfLastWeek, comparisonEnd: endOfLastWeek, label: "this week" };
  }
  if (normalizedQuery.includes("last week")) {
    return { start: startOfLastWeek, end: endOfLastWeek, comparisonStart: new Date(startOfLastWeek.getTime() - 7 * 24 * 60 * 60 * 1000), comparisonEnd: new Date(endOfLastWeek.getTime() - 7 * 24 * 60 * 60 * 1000), label: "last week" };
  }
  if (normalizedQuery.includes("this month")) {
    return { start: startOfMonth, end: endOfMonth, comparisonStart: startOfLastMonth, comparisonEnd: endOfLastMonth, label: "this month" };
  }
  if (normalizedQuery.includes("last month")) {
    return { start: startOfLastMonth, end: endOfLastMonth, comparisonStart: new Date(startOfLastMonth.getTime() - 30 * 24 * 60 * 60 * 1000), comparisonEnd: new Date(endOfLastMonth.getTime() - 30 * 24 * 60 * 60 * 1000), label: "last month" };
  }
  if (normalizedQuery.includes("this year")) {
    return { start: startOfYear, end: endOfYear, label: "this year" };
  }
  if (normalizedQuery.includes("last 7 days") || normalizedQuery.includes("past 7 days") || normalizedQuery.includes("7 days")) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now, comparisonStart: prevStart, comparisonEnd: start, label: "last 7 days" };
  }
  if (normalizedQuery.includes("last 30 days") || normalizedQuery.includes("past 30 days") || normalizedQuery.includes("30 days") || normalizedQuery.includes("last month") || normalizedQuery.includes("recently") || normalizedQuery.includes("lately")) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end: now, comparisonStart: prevStart, comparisonEnd: start, label: "last 30 days" };
  }
  if (normalizedQuery.includes("last 90 days") || normalizedQuery.includes("past 90 days") || normalizedQuery.includes("90 days") || normalizedQuery.includes("quarter")) {
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start, end: now, comparisonStart: prevStart, comparisonEnd: start, label: "last 90 days" };
  }

  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end: now, comparisonStart: prevStart, comparisonEnd: start, label: "last 30 days" };
}
