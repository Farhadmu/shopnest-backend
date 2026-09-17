import { CustomerCopilotIntent, CustomerCopilotResponse, CustomerCopilotMetric, CustomerCopilotInsight, CustomerCopilotAction } from "./customer-copilot.types";
import { detectIntent, detectTimeRange } from "./customer-copilot.intent";
import { buildCopilotContext, BuiltContext } from "./customer-copilot.context";
import { CUSTOMER_COPILOT_SYSTEM_PROMPT, buildCustomerUserPrompt } from "./customer-copilot.prompts";
import { completeWithContext, AiContext } from "../providers/claude.provider";
import { logAiIncident } from "../incident/incident.service";
import { searchProducts } from "./customer-copilot.tools";

function formatContextForAI(context: BuiltContext): string {
  const parts: string[] = [];
  for (const section of context.sections) {
    parts.push(`=== ${section.title} ===`);
    if (section.metrics) {
      for (const metric of section.metrics) {
        let line = `${metric.label}: ${metric.formatted}`;
        if (metric.changePercent !== undefined) {
          line += ` (${metric.changePercent >= 0 ? "+" : ""}${metric.changePercent}%)`;
        }
        parts.push(line);
      }
    }
    if (section.insights) {
      for (const insight of section.insights) {
        parts.push(`[${insight.severity.toUpperCase()}] ${insight.title}: ${insight.description}`);
        if (insight.evidence) {
          for (const ev of insight.evidence) {
            parts.push(`  - ${ev.fact}: ${ev.value}`);
          }
        }
      }
    }
    if (section.data && typeof section.data === "object") {
      parts.push(`RAW_DATA: ${JSON.stringify(section.data)}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

function generateFallbackResponse(context: BuiltContext): CustomerCopilotResponse {
  const metrics: CustomerCopilotMetric[] = [];
  const insights: CustomerCopilotInsight[] = [];
  const actions: CustomerCopilotAction[] = generateActions(context.intent);

  for (const section of context.sections) {
    if (section.metrics) metrics.push(...section.metrics);
    if (section.insights) {
      insights.push(...section.insights);
    }
  }

  let summary = "I've retrieved your live ShopNest data directly from your verified account! 📊";
  if (context.intent === CustomerCopilotIntent.ORDER_STATUS || context.intent === CustomerCopilotIntent.TRACKING) {
    summary = "Here is your active order and delivery tracking status from your account 📦🚚.";
  } else if (context.intent === CustomerCopilotIntent.BUDGET) {
    summary = "Here is your verified spending summary and breakdown from your purchase history 💰.";
  } else if (context.intent === CustomerCopilotIntent.WISHLIST) {
    summary = "Here are the items saved in your personal wishlist ❤️.";
  } else if (context.intent === CustomerCopilotIntent.CART) {
    summary = "Here is your current cart snapshot ready for checkout 🛍️.";
  } else if (context.intent === CustomerCopilotIntent.RETURN) {
    summary = "Here is your return eligibility information for recent delivered orders 🔄.";
  }

  return {
    answer: summary,
    summary,
    intent: context.intent,
    confidence: 0.85,
    timeRange: context.timeRange,
    metrics,
    insights,
    sources: context.sources,
    suggestedActions: actions.slice(0, 4),
    isFallback: true,
  };
}

function generateActions(intent: CustomerCopilotIntent): CustomerCopilotAction[] {
  const actions: CustomerCopilotAction[] = [];
  switch (intent) {
    case CustomerCopilotIntent.ORDER_STATUS:
    case CustomerCopilotIntent.TRACKING:
      actions.push({ label: "📦 My Orders", action: "navigate", targetUrl: "/dashboard/user/orders" });
      actions.push({ label: "🛍️ Continue Shopping", action: "navigate", targetUrl: "/products" });
      break;
    case CustomerCopilotIntent.ORDER_HISTORY:
      actions.push({ label: "📦 View All Orders", action: "navigate", targetUrl: "/dashboard/user/orders" });
      actions.push({ label: "📈 Spending Analytics", action: "navigate", targetUrl: "/dashboard/user/analytics" });
      break;
    case CustomerCopilotIntent.WISHLIST:
      actions.push({ label: "❤️ Open Wishlist", action: "navigate", targetUrl: "/wishlist" });
      actions.push({ label: "🛒 Go to Cart", action: "navigate", targetUrl: "/cart" });
      break;
    case CustomerCopilotIntent.CART:
      actions.push({ label: "🛒 Open Cart", action: "navigate", targetUrl: "/cart" });
      actions.push({ label: "🎯 Shopping Goals", action: "navigate", targetUrl: "/dashboard/user/goals" });
      break;
    case CustomerCopilotIntent.BUDGET:
      actions.push({ label: "📈 Spending Analytics", action: "navigate", targetUrl: "/dashboard/user/analytics" });
      actions.push({ label: "🎯 Shopping Goals", action: "navigate", targetUrl: "/dashboard/user/goals" });
      break;
    case CustomerCopilotIntent.SHOPPING_GOAL:
      actions.push({ label: "🎯 Shopping Goals", action: "navigate", targetUrl: "/dashboard/user/goals" });
      actions.push({ label: "🛡️ Product Lifecycle", action: "navigate", targetUrl: "/dashboard/user/lifecycle" });
      break;
    case CustomerCopilotIntent.RETURN:
    case CustomerCopilotIntent.REFUND:
      actions.push({ label: "📦 Orders & Returns", action: "navigate", targetUrl: "/dashboard/user/orders" });
      actions.push({ label: "🛡️ Warranty & Lifecycle", action: "navigate", targetUrl: "/dashboard/user/lifecycle" });
      break;
    case CustomerCopilotIntent.DEAL:
      actions.push({ label: "🏷️ Browse Flash Deals", action: "navigate", targetUrl: "/products" });
      actions.push({ label: "🛒 Check Cart Discounts", action: "navigate", targetUrl: "/cart" });
      break;
    case CustomerCopilotIntent.NOTIFICATION:
      actions.push({ label: "🔔 View Notifications", action: "navigate", targetUrl: "/dashboard/user/notifications" });
      actions.push({ label: "🔐 Security Center", action: "navigate", targetUrl: "/dashboard/user/security" });
      break;
    default:
      actions.push({ label: "📊 Dashboard Overview", action: "navigate", targetUrl: "/dashboard/user" });
      actions.push({ label: "📦 View Orders", action: "navigate", targetUrl: "/dashboard/user/orders" });
      actions.push({ label: "❤️ My Wishlist", action: "navigate", targetUrl: "/wishlist" });
      break;
  }
  return actions.slice(0, 3);
}

export async function handleCustomerCopilotQuery(
  query: string,
  userId: string,
  conversationMessages?: Array<{ role: string; content: string }>
): Promise<CustomerCopilotResponse> {
  try {
    const intentDetection = detectIntent(query);
    const timeRange = detectTimeRange(query);

    const context = await buildCopilotContext(intentDetection.intent, timeRange, userId);
    const contextString = formatContextForAI(context);

    let productCandidates: Array<{ id: string; title: string; price: number; category: string; ratingAvg: number; stock: number }> = [];
    if (
      [
        CustomerCopilotIntent.PRODUCT_DISCOVERY,
        CustomerCopilotIntent.RECOMMENDATION,
        CustomerCopilotIntent.BUDGET,
        CustomerCopilotIntent.SHOPPING_GOAL,
        CustomerCopilotIntent.WISHLIST,
      ].includes(intentDetection.intent)
    ) {
      try {
        productCandidates = await searchProducts(query);
      } catch {
        // ignore product search errors
      }
    }

    const productContext =
      productCandidates.length > 0
        ? `\n\nCANDIDATE PRODUCTS FROM CATALOG:\n${productCandidates
            .map((p) => `- [${p.id}] ${p.title} | ৳${p.price} | ${p.category} | rating ${p.ratingAvg}/5 | stock ${p.stock}`)
            .join("\n")}`
        : "";

    const aiContext: AiContext = {
      products: productCandidates,
      userContext: context.sections.reduce((acc, s) => ({ ...acc, ...((s.data as Record<string, unknown>) || {}) }), {}),
    };

    const historyMessages = conversationMessages
      ? conversationMessages.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [];
    const userMessage = buildCustomerUserPrompt(query, contextString + productContext, timeRange.label);
    const messages = [...historyMessages.slice(0, -1), { role: "user" as const, content: userMessage }];

    let answer: string;
    let isFallback = false;
    let provider: string | undefined;

    try {
      const result = await completeWithContext(
        messages,
        aiContext,
        { system: CUSTOMER_COPILOT_SYSTEM_PROMPT, maxTokens: 1500, temperature: 0.3 }
      );
      answer = result.content;
      isFallback = result.isFallback;
      provider = result.provider;
    } catch (aiError) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId,
        endpoint: "/ai/customer-copilot",
        input: query,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });
      const fallback = generateFallbackResponse(context);
      answer = fallback.answer;
      isFallback = true;
    }

    const metrics: CustomerCopilotMetric[] = [];
    const insights: CustomerCopilotInsight[] = [];

    for (const section of context.sections) {
      if (section.metrics) metrics.push(...section.metrics);
      if (section.insights) insights.push(...section.insights);
    }

    const response: CustomerCopilotResponse = {
      answer,
      summary:
        insights.length > 0
          ? `${insights.length} key insight${insights.length > 1 ? "s" : ""} identified.`
          : "Verified shopping response complete.",
      intent: intentDetection.intent,
      confidence: intentDetection.confidence,
      timeRange,
      metrics,
      insights,
      sources: context.sources,
      suggestedActions: generateActions(intentDetection.intent),
      isFallback,
      provider,
      providerStatus: isFallback ? "unavailable" : "available",
    };

    return response;
  } catch (error) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId,
      endpoint: "/ai/customer-copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
