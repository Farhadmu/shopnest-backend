import { SellerCopilotIntent, SellerCopilotResponse, SellerCopilotMetric, SellerCopilotInsight, SellerCopilotAction } from "./seller-copilot.types";
import { detectIntent, detectTimeRange } from "./seller-copilot.intent";
import { buildCopilotContext, BuiltContext } from "./seller-copilot.context";
import { SELLER_COPILOT_SYSTEM_PROMPT, buildSellerUserPrompt } from "./seller-copilot.prompts";
import { completeWithContext, AiContext } from "../providers/claude.provider";
import { logAiIncident } from "../incident/incident.service";

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

function generateFallbackResponse(context: BuiltContext): SellerCopilotResponse {
  const metrics: SellerCopilotMetric[] = [];
  const insights: SellerCopilotInsight[] = [];
  const actions: SellerCopilotAction[] = [];

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
    ? `Found ${insights.length} important insight${insights.length > 1 ? "s" : ""} requiring attention.`
    : "Store data retrieved successfully.";

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

function generateActions(intent: SellerCopilotIntent): SellerCopilotAction[] {
  const actions: SellerCopilotAction[] = [];
  switch (intent) {
    case SellerCopilotIntent.STORE_OVERVIEW:
      actions.push({ label: "View Dashboard", action: "navigate", targetUrl: "/dashboard/seller" });
      actions.push({ label: "View Orders", action: "navigate", targetUrl: "/dashboard/seller/orders" });
      break;
    case SellerCopilotIntent.REVENUE_ANALYSIS:
    case SellerCopilotIntent.SALES_ANALYSIS:
      actions.push({ label: "View Sales Analytics", action: "navigate", targetUrl: "/dashboard/seller/analytics" });
      actions.push({ label: "View Orders", action: "navigate", targetUrl: "/dashboard/seller/orders" });
      break;
    case SellerCopilotIntent.ORDER_ANALYSIS:
      actions.push({ label: "Manage Orders", action: "navigate", targetUrl: "/dashboard/seller/orders" });
      break;
    case SellerCopilotIntent.PRODUCT_ANALYSIS:
      actions.push({ label: "Manage Products", action: "navigate", targetUrl: "/dashboard/seller/products" });
      break;
    case SellerCopilotIntent.INVENTORY_ANALYSIS:
      actions.push({ label: "Manage Inventory", action: "navigate", targetUrl: "/dashboard/seller/inventory" });
      break;
    case SellerCopilotIntent.REVIEW_ANALYSIS:
      actions.push({ label: "View Reviews", action: "navigate", targetUrl: "/dashboard/seller/reviews" });
      break;
    case SellerCopilotIntent.RETURN_ANALYSIS:
      actions.push({ label: "View Returns", action: "navigate", targetUrl: "/dashboard/seller/returns" });
      break;
    case SellerCopilotIntent.CATEGORY_ANALYSIS:
      actions.push({ label: "View Categories", action: "navigate", targetUrl: "/dashboard/seller/categories" });
      break;
    case SellerCopilotIntent.RECOMMENDATION:
      actions.push({ label: "View Command Center", action: "navigate", targetUrl: "/dashboard/seller" });
      break;
    default:
      actions.push({ label: "View Dashboard", action: "navigate", targetUrl: "/dashboard/seller" });
      break;
  }
  return actions.slice(0, 3);
}

export async function handleSellerCopilotQuery(query: string, userId: string, conversationMessages?: Array<{ role: string; content: string }>): Promise<SellerCopilotResponse> {
  const startTime = Date.now();

  try {
    const intentDetection = detectIntent(query);
    const timeRange = detectTimeRange(query);

    const context = await buildCopilotContext(intentDetection.intent, timeRange, userId);
    const contextString = formatContextForAI(context);

    const aiContext: AiContext = {
      userContext: context.sections.reduce((acc, s) => ({ ...acc, ...(s.data as Record<string, unknown> || {}) }), {}),
    };

    const historyMessages = conversationMessages
      ? conversationMessages.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [];
    const userMessage = buildSellerUserPrompt(query, contextString, timeRange.label);
    const messages = [...historyMessages.slice(0, -1), { role: "user" as const, content: userMessage }];

    let answer: string;
    let isFallback = false;
    let provider: string | undefined;

    try {
      const result = await completeWithContext(
        messages,
        aiContext,
        { system: SELLER_COPILOT_SYSTEM_PROMPT, maxTokens: 1500, temperature: 0.3 }
      );
      answer = result.content;
      isFallback = result.isFallback;
      provider = result.provider;
    } catch (aiError) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId,
        endpoint: "/ai/seller-copilot",
        input: query,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });
      const fallback = generateFallbackResponse(context);
      answer = fallback.summary;
      isFallback = true;
    }

    const metrics: SellerCopilotMetric[] = [];
    const insights: SellerCopilotInsight[] = [];

    for (const section of context.sections) {
      if (section.metrics) metrics.push(...section.metrics);
      if (section.insights) insights.push(...section.insights);
    }

    const response: SellerCopilotResponse = {
      answer,
      summary: insights.length > 0
        ? `${insights.length} key insight${insights.length > 1 ? "s" : ""} identified.`
        : "Data analysis complete.",
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
      endpoint: "/ai/seller-copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
