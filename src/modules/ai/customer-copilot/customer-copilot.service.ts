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
    parts.push("");
  }
  return parts.join("\n");
}

function generateFallbackResponse(context: BuiltContext): CustomerCopilotResponse {
  const metrics: CustomerCopilotMetric[] = [];
  const insights: CustomerCopilotInsight[] = [];
  const actions: CustomerCopilotAction[] = [];

  for (const section of context.sections) {
    if (section.metrics) metrics.push(...section.metrics);
    if (section.insights) {
      insights.push(...section.insights);
      for (const insight of section.insights) {
        if (insight.severity === "critical" || insight.severity === "high") {
          actions.push({
            label: `Investigate: ${insight.title}`,
            action: "investigate",
            description: insight.description,
          });
        }
      }
    }
  }

  const summary = insights.length > 0
    ? `Found ${insights.length} important insight${insights.length > 1 ? "s" : ""}.`
    : "Your shopping data retrieved successfully.";

  return {
    answer: summary,
    summary,
    intent: context.intent,
    confidence: 0.8,
    timeRange: context.timeRange,
    metrics,
    insights,
    sources: context.sources,
    suggestedActions: actions.slice(0, 5),
    isFallback: true,
  };
}

function generateActions(intent: CustomerCopilotIntent): CustomerCopilotAction[] {
  const actions: CustomerCopilotAction[] = [];
  switch (intent) {
    case CustomerCopilotIntent.ORDER_STATUS:
    case CustomerCopilotIntent.ORDER_HISTORY:
      actions.push({ label: "View Orders", action: "navigate", targetUrl: "/orders" });
      actions.push({ label: "Track Order", action: "navigate", targetUrl: "/orders/tracking" });
      break;
    case CustomerCopilotIntent.WISHLIST:
      actions.push({ label: "View Wishlist", action: "navigate", targetUrl: "/wishlist" });
      break;
    case CustomerCopilotIntent.CART:
      actions.push({ label: "View Cart", action: "navigate", targetUrl: "/cart" });
      break;
    case CustomerCopilotIntent.PRODUCT_DISCOVERY:
    case CustomerCopilotIntent.RECOMMENDATION:
      actions.push({ label: "Browse Products", action: "navigate", targetUrl: "/products" });
      break;
    case CustomerCopilotIntent.REVIEW:
      actions.push({ label: "My Reviews", action: "navigate", targetUrl: "/account/reviews" });
      break;
    case CustomerCopilotIntent.RETURN:
    case CustomerCopilotIntent.REFUND:
      actions.push({ label: "Returns Center", action: "navigate", targetUrl: "/account/returns" });
      break;
    case CustomerCopilotIntent.DEAL:
      actions.push({ label: "View Deals", action: "navigate", targetUrl: "/deals" });
      break;
    default:
      actions.push({ label: "Browse Products", action: "navigate", targetUrl: "/products" });
      break;
  }
  return actions.slice(0, 3);
}

export async function handleCustomerCopilotQuery(query: string, userId: string, conversationMessages?: Array<{ role: string; content: string }>): Promise<CustomerCopilotResponse> {
  const startTime = Date.now();

  try {
    const intentDetection = detectIntent(query);
    const timeRange = detectTimeRange(query);

    const context = await buildCopilotContext(intentDetection.intent, timeRange, userId);
    const contextString = formatContextForAI(context);

    let productCandidates: Array<{ id: string; title: string; price: number; category: string; ratingAvg: number; stock: number }> = [];
    if ([CustomerCopilotIntent.PRODUCT_DISCOVERY, CustomerCopilotIntent.RECOMMENDATION, CustomerCopilotIntent.BUDGET, CustomerCopilotIntent.SHOPPING_GOAL].includes(intentDetection.intent)) {
      try {
        productCandidates = await searchProducts(query);
      } catch {
        // ignore product search errors
      }
    }

    const productContext = productCandidates.length > 0
      ? `\n\nCANDIDATE PRODUCTS:\n${productCandidates.map((p) => `- [${p.id}] ${p.title} | ৳${p.price} | ${p.category} | rating ${p.ratingAvg}/5 | stock ${p.stock}`).join("\n")}`
      : "";

    const aiContext: AiContext = {
      products: productCandidates,
      userContext: context.sections.reduce((acc, s) => ({ ...acc, ...(s.data as Record<string, unknown> || {}) }), {}),
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
      answer = fallback.summary;
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
      summary: insights.length > 0
        ? `${insights.length} key insight${insights.length > 1 ? "s" : ""} identified.`
        : "Response complete.",
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
