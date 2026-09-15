import { SellerCopilotIntent, TimeRange } from "./seller-copilot.types";

export interface DetectedIntent {
  intent: SellerCopilotIntent;
  confidence: number;
  keywords: string[];
}

const INTENT_PATTERNS: Array<{ intent: SellerCopilotIntent; patterns: string[] }> = [
  { intent: SellerCopilotIntent.STORE_OVERVIEW, patterns: ["store overview", "how is my store", "store doing", "store health", "overview of my business", "give me an overview", "store status", "business overview", "business brief", "today's brief", "daily brief", "morning brief"] },
  { intent: SellerCopilotIntent.REVENUE_ANALYSIS, patterns: ["revenue", "earning", "income", "profit", "money made", "how much did i sell", "total sales", "sales amount", "revenue this month", "revenue this week"] },
  { intent: SellerCopilotIntent.SALES_ANALYSIS, patterns: ["sales", "units sold", "how much did i sell", "sales trend", "sales performance", "best selling", "top selling", "what sold"] },
  { intent: SellerCopilotIntent.ORDER_ANALYSIS, patterns: ["orders", "pending orders", "show orders", "order status", "which orders", "orders need attention", "order count"] },
  { intent: SellerCopilotIntent.PRODUCT_ANALYSIS, patterns: ["product", "best product", "top product", "product performance", "which product", "products performing", "promote", "stop promoting"] },
  { intent: SellerCopilotIntent.INVENTORY_ANALYSIS, patterns: ["inventory", "stock", "low stock", "out of stock", "running low", "restock", "restocking", "inventory status"] },
  { intent: SellerCopilotIntent.CUSTOMER_ANALYSIS, patterns: ["customer", "buyer", "customer behavior", "customer segment", "repeat customer", "retention", "churn"] },
  { intent: SellerCopilotIntent.REVIEW_ANALYSIS, patterns: ["review", "rating", "feedback", "poor rating", "bad review", "customer complaint", "summarize review", "review sentiment"] },
  { intent: SellerCopilotIntent.RETURN_ANALYSIS, patterns: ["return", "refund", "return rate", "highest return", "cancellation", "cancelled"] },
  { intent: SellerCopilotIntent.CATEGORY_ANALYSIS, patterns: ["category", "which category", "category revenue", "category sales", "best category", "top category"] },
  { intent: SellerCopilotIntent.FORECAST_ANALYSIS, patterns: ["forecast", "predict", "projection", "future sales", "next month", "expected", "projected", "30-day forecast"] },
  { intent: SellerCopilotIntent.RECOMMENDATION, patterns: ["recommend", "suggestion", "advice", "what should", "actionable", "recommendation", "what to do", "improve sales", "increase sales", "what should i do today"] },
  { intent: SellerCopilotIntent.ROOT_CAUSE_ANALYSIS, patterns: ["why", "reason", "cause", "root cause", "what caused", "why did", "why is", "why are", "why did sales drop", "why sales dropped", "sales drop", "sales dropped", "drop in sales", "decrease in sales"] },
  { intent: SellerCopilotIntent.COMPARISON, patterns: ["compare", "comparison", "versus", "vs", "difference between", "this month vs last", "compare this month"] },
  { intent: SellerCopilotIntent.TREND_ANALYSIS, patterns: ["trend", "trending", "over time", "pattern", "historical", "sales trend", "show trend"] },
];

export function detectIntent(query: string): DetectedIntent {
  const normalizedQuery = query.toLowerCase().trim();

  let bestMatch: DetectedIntent = { intent: SellerCopilotIntent.UNKNOWN, confidence: 0, keywords: [] };

  for (const { intent, patterns } of INTENT_PATTERNS) {
    const matchedPatterns = patterns.filter((p) => normalizedQuery.includes(p));
    if (matchedPatterns.length > 0) {
      const confidence = Math.min(matchedPatterns.length / patterns.length + 0.5, 1);
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent, confidence, keywords: matchedPatterns };
      }
    }
  }

  if (bestMatch.intent === SellerCopilotIntent.UNKNOWN) {
    if (normalizedQuery.includes("?") || normalizedQuery.length > 10) {
      return { intent: SellerCopilotIntent.STORE_OVERVIEW, confidence: 0.3, keywords: [] };
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
  if (normalizedQuery.includes("last 30 days") || normalizedQuery.includes("past 30 days") || normalizedQuery.includes("30 days") || normalizedQuery.includes("recently") || normalizedQuery.includes("lately")) {
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
