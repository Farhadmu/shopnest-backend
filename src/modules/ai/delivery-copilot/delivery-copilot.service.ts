import {
  DeliveryCopilotIntent,
  DeliveryCopilotResponse,
  DeliveryCopilotMetric,
  DeliveryCopilotInsight,
  DeliveryCopilotAction,
} from "./delivery-copilot.types";
import { detectIntent, detectTimeRange } from "./delivery-copilot.intent";
import { buildDeliveryCopilotContext, BuiltDeliveryContext } from "./delivery-copilot.context";
import { DELIVERY_COPILOT_SYSTEM_PROMPT, buildDeliveryUserPrompt } from "./delivery-copilot.prompts";
import { completeWithContext, AiContext } from "../providers/claude.provider";
import { logAiIncident } from "../incident/incident.service";

function formatContextForAI(context: BuiltDeliveryContext): string {
  const parts: string[] = [];
  for (const section of context.sections) {
    parts.push(`=== ${section.title} ===`);
    if (section.metrics) {
      for (const metric of section.metrics) {
        parts.push(`${metric.label}: ${metric.formatted}`);
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

function generateFallbackResponse(context: BuiltDeliveryContext): DeliveryCopilotResponse {
  const metrics: DeliveryCopilotMetric[] = [];
  const insights: DeliveryCopilotInsight[] = [];
  const actions: DeliveryCopilotAction[] = [];

  for (const section of context.sections) {
    if (section.metrics) metrics.push(...section.metrics);
    if (section.insights) insights.push(...section.insights);
  }

  let summary = "Here is your live delivery operational summary:";
  if (context.intent === DeliveryCopilotIntent.ORDER_RECOMMENDATION) {
    summary = "Review the available requests in your open marketplace and choose the one closest to your current area.";
    actions.push({ label: "Open Marketplace", action: "navigate", targetUrl: "/dashboard/delivery/available" });
  } else if (context.intent === DeliveryCopilotIntent.ACTIVE_WORKLOAD) {
    summary = `You currently have active deliveries in progress. Check the Active Delivery Cockpit to update milestones or enter OTP.`;
    actions.push({ label: "My Deliveries", action: "navigate", targetUrl: "/dashboard/delivery/my-deliveries" });
  } else if (context.intent === DeliveryCopilotIntent.INCIDENT_ADVICE) {
    summary = "If customer is unavailable or an exception occurs, please try calling first or file an incident report directly.";
    actions.push({ label: "Report Incident", action: "navigate", targetUrl: "/dashboard/delivery/incidents" });
  } else {
    actions.push({ label: "Delivery Dashboard", action: "navigate", targetUrl: "/dashboard/delivery" });
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
    suggestedActions: actions,
    isFallback: true,
  };
}

function generateActions(intent: DeliveryCopilotIntent): DeliveryCopilotAction[] {
  const actions: DeliveryCopilotAction[] = [];
  switch (intent) {
    case DeliveryCopilotIntent.ORDER_RECOMMENDATION:
      actions.push({ label: "Browse Available Orders", action: "navigate", targetUrl: "/dashboard/delivery/available" });
      actions.push({ label: "Check Workload", action: "navigate", targetUrl: "/dashboard/delivery" });
      break;
    case DeliveryCopilotIntent.ACTIVE_WORKLOAD:
    case DeliveryCopilotIntent.PRIORITY_ADVICE:
      actions.push({ label: "Active Deliveries", action: "navigate", targetUrl: "/dashboard/delivery/my-deliveries" });
      actions.push({ label: "Command Center", action: "navigate", targetUrl: "/dashboard/delivery" });
      break;
    case DeliveryCopilotIntent.INCIDENT_ADVICE:
      actions.push({ label: "Report Incident", action: "navigate", targetUrl: "/dashboard/delivery/incidents" });
      actions.push({ label: "Contact Support", action: "navigate", targetUrl: "/support" });
      break;
    case DeliveryCopilotIntent.DAILY_SUMMARY:
      actions.push({ label: "View History", action: "navigate", targetUrl: "/dashboard/delivery/my-deliveries" });
      actions.push({ label: "View Profile", action: "navigate", targetUrl: "/dashboard/delivery/profile" });
      break;
    default:
      actions.push({ label: "Available Deliveries", action: "navigate", targetUrl: "/dashboard/delivery/available" });
      actions.push({ label: "Cockpit", action: "navigate", targetUrl: "/dashboard/delivery" });
      break;
  }
  return actions.slice(0, 3);
}

export async function handleDeliveryCopilotQuery(
  query: string,
  userId: string,
  conversationMessages?: Array<{ role: string; content: string }>
): Promise<DeliveryCopilotResponse> {
  try {
    const intentDetection = detectIntent(query);
    const timeRange = detectTimeRange(query);

    const context = await buildDeliveryCopilotContext(intentDetection.intent, timeRange, userId);
    const contextString = formatContextForAI(context);

    const aiContext: AiContext = {
      userContext: context.sections.reduce((acc, s) => ({ ...acc, ...(s.data as Record<string, unknown> || {}) }), {}),
    };

    const historyMessages = conversationMessages
      ? conversationMessages.slice(-8).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [];
    const userMessage = buildDeliveryUserPrompt(query, contextString, timeRange.label);
    const messages = [...historyMessages.slice(0, -1), { role: "user" as const, content: userMessage }];

    let answer: string;
    let isFallback = false;
    let provider: string | undefined;

    try {
      const result = await completeWithContext(
        messages,
        aiContext,
        { system: DELIVERY_COPILOT_SYSTEM_PROMPT, maxTokens: 1200, temperature: 0.3 }
      );
      answer = result.content;
      isFallback = result.isFallback;
      provider = result.provider;
    } catch (aiError) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId,
        endpoint: "/ai/delivery-copilot",
        input: query,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });
      const fallback = generateFallbackResponse(context);
      answer = fallback.summary;
      isFallback = true;
    }

    const metrics: DeliveryCopilotMetric[] = [];
    const insights: DeliveryCopilotInsight[] = [];

    for (const section of context.sections) {
      if (section.metrics) metrics.push(...section.metrics);
      if (section.insights) insights.push(...section.insights);
    }

    return {
      answer,
      summary: insights.length > 0
        ? `${insights.length} operational insight${insights.length > 1 ? "s" : ""} retrieved from real records.`
        : "Operational telemetry processed.",
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
  } catch (error) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId,
      endpoint: "/ai/delivery-copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
