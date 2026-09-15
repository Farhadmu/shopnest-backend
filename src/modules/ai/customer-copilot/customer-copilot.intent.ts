import { CustomerCopilotIntent, TimeRange } from "./customer-copilot.types";

export interface DetectedIntent {
  intent: CustomerCopilotIntent;
  confidence: number;
  keywords: string[];
}

const INTENT_PATTERNS: Array<{ intent: CustomerCopilotIntent; patterns: string[] }> = [
  { intent: CustomerCopilotIntent.ORDER_STATUS, patterns: ["order status", "where is my order", "track order", "order tracking", "when will my order", "amar order", "amar order koi", "order kobe ashbe", "order ta koi"] },
  { intent: CustomerCopilotIntent.ORDER_HISTORY, patterns: ["order history", "past orders", "previous orders", "my orders", "what did i buy", "last order", "purchase history", "ager order", "amar ager order"] },
  { intent: CustomerCopilotIntent.PRODUCT_DISCOVERY, patterns: ["find", "search", "show me", "looking for", "i need", "i want", "under", "below", "budget", "headphone", "laptop", "phone", "gaming", "recommend", "suggest", "khojo", "dekhao", "chai", "lagbe", "moddhe", "niche", "jonno"] },
  { intent: CustomerCopilotIntent.PRODUCT_COMPARISON, patterns: ["compare", "comparison", "versus", "vs", "which is better", "better option", "cheaper", "better reviews", "compare these"] },
  { intent: CustomerCopilotIntent.WISHLIST, patterns: ["wishlist", "saved items", "saved products", "my wishlist", "amar wishlist"] },
  { intent: CustomerCopilotIntent.CART, patterns: ["cart", "my cart", "in my cart", "add to cart", "checkout"] },
  { intent: CustomerCopilotIntent.RECOMMENDATION, patterns: ["recommend", "suggestion", "suggest", "best", "top", "popular", "highly rated", "bhalo", "better"] },
  { intent: CustomerCopilotIntent.REVIEW, patterns: ["review", "rating", "feedback", "summarize reviews", "what people say", "review summary"] },
  { intent: CustomerCopilotIntent.RETURN, patterns: ["return", "exchange", "return policy", "return product", "exchange product"] },
  { intent: CustomerCopilotIntent.REFUND, patterns: ["refund", "refund status", "money back", "refunded"] },
  { intent: CustomerCopilotIntent.DEAL, patterns: ["deal", "coupon", "discount", "offer", "promo", "best price", "cheapest", "negotiate"] },
  { intent: CustomerCopilotIntent.NOTIFICATION, patterns: ["notification", "alert", "update", "new message", "notifications"] },
  { intent: CustomerCopilotIntent.BUDGET, patterns: ["budget", "under", "below", "within", "price range", "affordable", "cheap", "takar moddhe", "moddhe"] },
  { intent: CustomerCopilotIntent.SHOPPING_GOAL, patterns: ["goal", "plan", "setup", "build", "complete", "gaming setup", "office setup"] },
  { intent: CustomerCopilotIntent.TRACKING, patterns: ["track", "tracking", "delivery", "shipping", "courier", "where is", "kothay", "kobe ashbe"] },
];

export function detectIntent(query: string): DetectedIntent {
  const normalizedQuery = query.toLowerCase().trim();

  let bestMatch: DetectedIntent = { intent: CustomerCopilotIntent.UNKNOWN, confidence: 0, keywords: [] };

  for (const { intent, patterns } of INTENT_PATTERNS) {
    const matchedPatterns = patterns.filter((p) => normalizedQuery.includes(p));
    if (matchedPatterns.length > 0) {
      const confidence = Math.min(matchedPatterns.length / patterns.length + 0.5, 1);
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent, confidence, keywords: matchedPatterns };
      }
    }
  }

  if (bestMatch.intent === CustomerCopilotIntent.UNKNOWN) {
    if (normalizedQuery.includes("?") || normalizedQuery.length > 10) {
      return { intent: CustomerCopilotIntent.GENERAL_CHAT, confidence: 0.3, keywords: [] };
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

  if (normalizedQuery.includes("today")) {
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
    return { start: startOfLastWeek, end: endOfLastWeek, label: "last week" };
  }
  if (normalizedQuery.includes("this month")) {
    return { start: startOfMonth, end: endOfMonth, comparisonStart: startOfLastMonth, comparisonEnd: endOfLastMonth, label: "this month" };
  }
  if (normalizedQuery.includes("last month")) {
    return { start: startOfLastMonth, end: endOfLastMonth, label: "last month" };
  }
  if (normalizedQuery.includes("last 7 days") || normalizedQuery.includes("past 7 days") || normalizedQuery.includes("7 days")) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now, label: "last 7 days" };
  }
  if (normalizedQuery.includes("last 30 days") || normalizedQuery.includes("past 30 days") || normalizedQuery.includes("30 days") || normalizedQuery.includes("recently") || normalizedQuery.includes("lately")) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end: now, label: "last 30 days" };
  }
  if (normalizedQuery.includes("last 90 days") || normalizedQuery.includes("past 90 days") || normalizedQuery.includes("90 days") || normalizedQuery.includes("quarter")) {
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start, end: now, label: "last 90 days" };
  }

  return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now, label: "last 30 days" };
}
