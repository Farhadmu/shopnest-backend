export type AdminAIIntentType =
  | "BRIEFING"
  | "GET_SELLERS"
  | "GET_PENDING_SELLERS"
  | "REJECT_SELLER"
  | "APPROVE_SELLER"
  | "SUSPEND_SELLER"
  | "GET_LOW_STOCK_PRODUCTS"
  | "GET_PRODUCTS"
  | "GET_ORDERS"
  | "GET_DELAYED_ORDERS"
  | "CANCEL_ORDER"
  | "GET_DELIVERY_FLEET"
  | "GET_REVENUE_ANALYTICS"
  | "GET_ANOMALIES"
  | "GET_INCIDENTS"
  | "DISABLE_COUPON"
  | "BROADCAST_NOTIFICATION"
  | "NAVIGATION"
  | "FOLLOW_UP"
  | "CONFIRM_ACTION"
  | "CANCEL_ACTION"
  | "GENERAL_QUERY";

export interface ParsedAdminIntent {
  intent: AdminAIIntentType;
  confidence: number;
  entities: {
    sellerName?: string;
    sellerId?: string;
    orderId?: string;
    couponCode?: string;
    incidentId?: string;
    reason?: string;
    statusFilter?: string;
    ordinalReference?: "first" | "second" | "third" | "last" | "that_one";
    targetNavigationUrl?: string;
  };
  originalQuery: string;
  normalizedQuery: string;
  language: "en" | "bn" | "banglish";
}

/**
 * Normalizes mixed English, Bengali, and Banglish query into standard tokens
 */
export function normalizeQuery(query: string): { normalized: string; lang: "en" | "bn" | "banglish" } {
  const trimmed = query.trim().toLowerCase();

  // Detect Bengali Unicode characters
  const hasBengaliScript = /[\u0980-\u09FF]/.test(query);

  let lang: "en" | "bn" | "banglish" = "en";
  if (hasBengaliScript) {
    lang = "bn";
  } else if (
    /\b(gula|gulo|shob|dekhao|dekhaw|koi|kore|dao|koro|ajker|kalker|kalke|keno|oita|sheita|ager|komlo|ber|bhalo|kharap|prothom|ditio|dorkar|nai)\b/i.test(
      trimmed
    )
  ) {
    lang = "banglish";
  }

  // Standardize common Banglish / Bengali variations
  let normalized = trimmed
    .replace(/\b(dekhaw|dekhaw|dekao|dekhao|dekhi|show|list|view|ber koro|ber kran)\b/gi, "show")
    .replace(/\b(gula|gulo|shob|all|shobgula)\b/gi, "all")
    .replace(/\b(ajker|today's|aajker)\b/gi, "today")
    .replace(/\b(kalker|kalke|yesterday)\b/gi, "yesterday")
    .replace(/\b(koto|how much|amount)\b/gi, "how much")
    .replace(/\b(reject koro|reject kore dao|reject)\b/gi, "reject")
    .replace(/\b(approve koro|approve kore dao|approve)\b/gi, "approve")
    .replace(/\b(cancel koro|cancel kore dao|cancel)\b/gi, "cancel");

  return { normalized, lang };
}

export function normalizeAdminQuery(query: string): string {
  return normalizeQuery(query).normalized;
}

export function parseAdminIntent(rawQuery: string): ParsedAdminIntent {
  const { normalized, lang } = normalizeQuery(rawQuery);
  const entities: ParsedAdminIntent["entities"] & { isLowStock?: boolean; deliveryStatus?: string; sellerStatus?: string } = {};

  // Extract ordinals first (can be used across multiple intents)
  if (/\b(first|1st|prothom|১ম|প্রথম)\b/i.test(rawQuery)) {
    entities.ordinalReference = "first";
  } else if (/\b(second|2nd|ditio|২য়|দ্বিতীয়)\b/i.test(rawQuery)) {
    entities.ordinalReference = "second";
  } else if (/\b(third|3rd|tritio|৩য়|তৃতীয়)\b/i.test(rawQuery)) {
    entities.ordinalReference = "third";
  } else if (/\b(last|shesh|শেষ|ager ta)\b/i.test(rawQuery)) {
    entities.ordinalReference = "last";
  } else if (/\b(that one|oita|sheita|oi ta)\b/i.test(rawQuery)) {
    entities.ordinalReference = "that_one";
  }

  // 1. Direct Confirmation or Cancellation
  const isAffirmative =
    /\b(yes|confirm|proceed|execute|agree|do it|ha|haan|koro)\b/i.test(normalized) ||
    rawQuery.includes("হ্যাঁ") ||
    rawQuery.includes("করো");
  const isNegative =
    /\b(no|cancel|na|naa|stop|abort|dont|don't|dorkar nai)\b/i.test(normalized) ||
    rawQuery.includes("বাতিল") ||
    rawQuery.includes("না");

  if (isNegative && !normalized.includes("order") && !normalized.includes("coupon")) {
    return {
      intent: "CANCEL_ACTION",
      confidence: 1.0,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  if (isAffirmative && !normalized.includes("reject") && !normalized.includes("show") && !normalized.includes("order")) {
    return {
      intent: "CONFIRM_ACTION",
      confidence: 1.0,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 2. Daily Executive Briefing
  if (
    normalized.includes("briefing") ||
    normalized.includes("overview") ||
    normalized.includes("summary") ||
    rawQuery.includes("ব্রিফিং") ||
    rawQuery.includes("খবর") ||
    normalized.includes("marketplace status") ||
    normalized.includes("daily report") ||
    normalized.includes("today report") ||
    normalized.includes("kemon cholche") ||
    normalized.includes("platform health")
  ) {
    return {
      intent: "BRIEFING",
      confidence: 0.95,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 3. Follow-up References with action
  if (entities.ordinalReference && (normalized.includes("reject") || rawQuery.includes("রিজেক্ট"))) {
    return { intent: "REJECT_SELLER", confidence: 0.92, entities, originalQuery: rawQuery, normalizedQuery: normalized, language: lang };
  }
  if (entities.ordinalReference && (normalized.includes("approve") || rawQuery.includes("অনুমোদন") || rawQuery.includes("এপ্রুভ"))) {
    return { intent: "APPROVE_SELLER", confidence: 0.92, entities, originalQuery: rawQuery, normalizedQuery: normalized, language: lang };
  }
  if (entities.ordinalReference) {
    return { intent: "FOLLOW_UP", confidence: 0.85, entities, originalQuery: rawQuery, normalizedQuery: normalized, language: lang };
  }

  // 4. Reject Seller with Name or Reason
  // Examples: "Reject the seller named Tech World because their verification documents are incomplete"
  // "Tech World ke reject kore dao"
  const rejectMatch = rawQuery.match(/reject\s+(the\s+seller\s+(named\s+)?)?([^,\.\nbecause]+)(because\s+(.+))?/i) ||
    rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+reject/i);

  if (rejectMatch && (normalized.includes("reject") || rawQuery.includes("রিজেক্ট"))) {
    let nameCandidate = "";
    if (rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+reject/i)) {
      nameCandidate = rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+reject/i)![1].trim();
    } else if (rejectMatch[3]) {
      nameCandidate = rejectMatch[3].replace(/named|seller|the/gi, "").trim();
    }

    if (rejectMatch[5]) {
      entities.reason = rejectMatch[5].trim();
    }

    if (nameCandidate && !["it", "that", "them", "seller"].includes(nameCandidate.toLowerCase())) {
      entities.sellerName = nameCandidate;
    }

    return {
      intent: "REJECT_SELLER",
      confidence: 0.92,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 5. Approve Seller
  const approveMatch = rawQuery.match(/approve\s+(the\s+seller\s+(named\s+)?)?([^,\.\n]+)/i) ||
    rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+approve/i);

  if (approveMatch && (normalized.includes("approve") || rawQuery.includes("অনুমোদন") || rawQuery.includes("এপ্রুভ"))) {
    let nameCandidate = "";
    if (rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+approve/i)) {
      nameCandidate = rawQuery.match(/([a-zA-Z0-9\s]+)\s+ke\s+approve/i)![1].trim();
    } else if (approveMatch[3]) {
      nameCandidate = approveMatch[3].replace(/named|seller|the/gi, "").trim();
    }
    if (nameCandidate && !["it", "that", "them", "seller"].includes(nameCandidate.toLowerCase())) {
      entities.sellerName = nameCandidate;
    }
    return {
      intent: "APPROVE_SELLER",
      confidence: 0.92,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 6. Sellers: Pending Sellers
  if (
    (normalized.includes("seller") || rawQuery.includes("সেলার") || normalized.includes("merchant") || normalized.includes("vendor")) &&
    (normalized.includes("pending") || normalized.includes("waiting") || rawQuery.includes("পেন্ডিং") || normalized.includes("approval"))
  ) {
    entities.sellerStatus = "pending";
    return {
      intent: "GET_PENDING_SELLERS",
      confidence: 0.95,
      entities: { ...entities, statusFilter: "pending", sellerStatus: "pending" },
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 7. Sellers: General Sellers Query
  if (
    normalized.includes("seller") ||
    rawQuery.includes("সেলার") ||
    normalized.includes("merchant") ||
    normalized.includes("vendor") ||
    normalized.includes("store")
  ) {
    return {
      intent: "GET_SELLERS",
      confidence: 0.9,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 8. Low-Stock Products
  if (
    (normalized.includes("stock") || rawQuery.includes("স্টক") || normalized.includes("inventory")) &&
    (normalized.includes("low") || normalized.includes("out") || normalized.includes("kom") || normalized.includes("shortage") || normalized.includes("zero"))
  ) {
    entities.isLowStock = true;
    return {
      intent: "GET_LOW_STOCK_PRODUCTS",
      confidence: 0.95,
      entities: { ...entities, isLowStock: true },
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 9. Products General
  if (normalized.includes("product") || rawQuery.includes("প্রোডাক্ট") || normalized.includes("item")) {
    return {
      intent: "GET_PRODUCTS",
      confidence: 0.88,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 10. Orders: Cancel Order
  const cancelOrderMatch = rawQuery.match(/cancel\s+order\s*(#|id)?\s*([a-zA-Z0-9_-]+)/i) ||
    rawQuery.match(/order\s*(#|id)?\s*([a-zA-Z0-9_-]+)\s*ta\s*cancel/i);

  if (cancelOrderMatch) {
    entities.orderId = cancelOrderMatch[2];
    return {
      intent: "CANCEL_ORDER",
      confidence: 0.95,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 11. Orders: Delayed Orders
  if (
    (normalized.includes("order") || rawQuery.includes("অর্ডার")) &&
    (normalized.includes("delayed") || normalized.includes("late") || normalized.includes("deri") || normalized.includes("stuck"))
  ) {
    return {
      intent: "GET_DELAYED_ORDERS",
      confidence: 0.95,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 12. Orders General
  if (normalized.includes("order") || rawQuery.includes("অর্ডার")) {
    return {
      intent: "GET_ORDERS",
      confidence: 0.88,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 13. Delivery Fleet / Riders
  if (
    normalized.includes("deliver") ||
    normalized.includes("rider") ||
    rawQuery.includes("ডেলিভারি") ||
    normalized.includes("courier") ||
    normalized.includes("fleet")
  ) {
    if (normalized.includes("delay") || normalized.includes("deri") || normalized.includes("failed") || rawQuery.includes("দেরি")) {
      entities.deliveryStatus = "delayed";
    }
    return {
      intent: "GET_DELIVERY_FLEET",
      confidence: 0.92,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 14. Revenue / GMV Analytics
  if (
    normalized.includes("revenue") ||
    normalized.includes("sales") ||
    normalized.includes("gmv") ||
    rawQuery.includes("রেভিনিউ") ||
    rawQuery.includes("সেলস") ||
    rawQuery.includes("আয়") ||
    rawQuery.includes("ইনকাম") ||
    normalized.includes("earning") ||
    normalized.includes("income")
  ) {
    return {
      intent: "GET_REVENUE_ANALYTICS",
      confidence: 0.92,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 15. Anomalies & Risk Center
  if (
    normalized.includes("anomaly") ||
    normalized.includes("anomalies") ||
    normalized.includes("leakage") ||
    normalized.includes("suspicious") ||
    rawQuery.includes("অস্বাভাবিক") ||
    normalized.includes("risk") ||
    normalized.includes("fraud")
  ) {
    return {
      intent: "GET_ANOMALIES",
      confidence: 0.9,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 16. Incidents
  if (normalized.includes("incident") || rawQuery.includes("ইনসিডেন্ট") || normalized.includes("complaint") || normalized.includes("dispute")) {
    return {
      intent: "GET_INCIDENTS",
      confidence: 0.9,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  // 17. Coupon
  const couponMatch = rawQuery.match(/coupon\s*([a-zA-Z0-9_-]+)/i);
  if (couponMatch || normalized.includes("coupon") || rawQuery.includes("কুপন") || normalized.includes("voucher")) {
    if (couponMatch) entities.couponCode = couponMatch[1];
    if (normalized.includes("disable") || normalized.includes("bondho")) {
      return { intent: "DISABLE_COUPON", confidence: 0.92, entities, originalQuery: rawQuery, normalizedQuery: normalized, language: lang };
    }
  }

  // 18. Navigation
  if (normalized.includes("open") || normalized.includes("take me to") || normalized.includes("go to") || normalized.includes("jao")) {
    let url = "/dashboard/admin";
    if (normalized.includes("seller")) url = "/dashboard/admin/sellers";
    else if (normalized.includes("order")) url = "/dashboard/admin/orders";
    else if (normalized.includes("product")) url = "/dashboard/admin/products";
    else if (normalized.includes("delivery") || normalized.includes("rider")) url = "/dashboard/admin/delivery-men";
    else if (normalized.includes("analytics") || normalized.includes("revenue")) url = "/dashboard/admin/analytics";
    else if (normalized.includes("category")) url = "/dashboard/admin/categories";
    else if (normalized.includes("incident") || normalized.includes("risk")) url = "/dashboard/admin/security";

    entities.targetNavigationUrl = url;
    return {
      intent: "NAVIGATION",
      confidence: 0.9,
      entities,
      originalQuery: rawQuery,
      normalizedQuery: normalized,
      language: lang,
    };
  }

  return {
    intent: "GENERAL_QUERY",
    confidence: 0.6,
    entities,
    originalQuery: rawQuery,
    normalizedQuery: normalized,
    language: lang,
  };
}
