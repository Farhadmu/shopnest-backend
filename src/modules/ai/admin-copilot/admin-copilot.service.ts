import { CopilotIntent, CopilotResponse, CopilotMetric, CopilotInsight, CopilotSource, CopilotAction } from "./admin-copilot.types";
import { detectIntent, detectTimeRange } from "./admin-copilot.intent";
import { buildCopilotContext, BuiltContext, ContextSection } from "./admin-copilot.context";
import { ADMIN_COPILOT_SYSTEM_PROMPT, buildUserPrompt } from "./admin-copilot.prompts";
import { completeWithContext, AiContext } from "../providers/claude.provider";
import { logAiIncident } from "../incident/incident.service";
import { AuditLog } from "../../security/auditLog.model";

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

function generateFallbackResponse(context: BuiltContext): CopilotResponse {
  const metrics: CopilotMetric[] = [];
  const insights: CopilotInsight[] = [];
  const actions: CopilotAction[] = [];

  for (const section of context.sections) {
    if (section.metrics) {
      metrics.push(...section.metrics);
    }
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
    : "Marketplace data retrieved successfully.";

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

function generateActions(intent: CopilotIntent): CopilotAction[] {
  const actions: CopilotAction[] = [];

  switch (intent) {
    case CopilotIntent.REVENUE_ANALYSIS:
    case CopilotIntent.GMV_ANALYSIS:
      actions.push({ label: "View Revenue Analytics", action: "navigate", targetUrl: "/dashboard/admin/analytics" });
      actions.push({ label: "View Revenue Leakage", action: "navigate", targetUrl: "/dashboard/admin?tab=leakage" });
      break;
    case CopilotIntent.SELLER_ANALYSIS:
    case CopilotIntent.SELLER_RISK:
      actions.push({ label: "View Seller Risk", action: "navigate", targetUrl: "/dashboard/admin?tab=seller_risk" });
      actions.push({ label: "View All Sellers", action: "navigate", targetUrl: "/dashboard/admin/sellers" });
      break;
    case CopilotIntent.SECURITY_ANALYSIS:
      actions.push({ label: "Security Center", action: "navigate", targetUrl: "/dashboard/admin/security" });
      break;
    case CopilotIntent.ANOMALY_ANALYSIS:
      actions.push({ label: "View Anomalies", action: "navigate", targetUrl: "/dashboard/admin?tab=anomalies" });
      break;
    case CopilotIntent.SYSTEM_HEALTH:
    case CopilotIntent.TELEMETRY_ANALYSIS:
      actions.push({ label: "System Telemetry", action: "navigate", targetUrl: "/dashboard/admin?tab=telemetry" });
      break;
    case CopilotIntent.CATEGORY_ANALYSIS:
      actions.push({ label: "View Categories", action: "navigate", targetUrl: "/dashboard/admin/categories" });
      break;
    case CopilotIntent.FRAUD_ANALYSIS:
    case CopilotIntent.REVENUE_LEAKAGE:
      actions.push({ label: "Risk & Fraud Center", action: "navigate", targetUrl: "/dashboard/admin/risk" });
      break;
    default:
      actions.push({ label: "View Dashboard", action: "navigate", targetUrl: "/dashboard/admin" });
      break;
  }

  return actions.slice(0, 3);
}

export async function handleAdminCopilotQuery(
  query: string,
  adminId?: string
): Promise<CopilotResponse> {
  const startTime = Date.now();

  try {
    const intentDetection = detectIntent(query);
    const timeRange = detectTimeRange(query);

    const context = await buildCopilotContext(intentDetection.intent, timeRange);
    const contextString = formatContextForAI(context);

    const aiContext: AiContext = {
      userContext: context.sections.reduce((acc, s) => ({ ...acc, ...(s.data || {}) }), {}),
    };

    const userMessage = buildUserPrompt(query, contextString, timeRange.label);

    let answer: string;
    let isFallback = false;

    try {
      const result = await completeWithContext(
        [{ role: "user", content: userMessage }],
        aiContext,
        { system: ADMIN_COPILOT_SYSTEM_PROMPT, maxTokens: 1000, temperature: 0.3 }
      );
      answer = result.content;
      isFallback = result.isFallback;
    } catch (aiError) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId: adminId,
        endpoint: "/ai/copilot",
        input: query,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });

      const fallback = generateFallbackResponse(context);
      answer = fallback.summary;
      isFallback = true;
    }

    const metrics: CopilotMetric[] = [];
    const insights: CopilotInsight[] = [];

    for (const section of context.sections) {
      if (section.metrics) metrics.push(...section.metrics);
      if (section.insights) insights.push(...section.insights);
    }

    const response: CopilotResponse = {
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
    };

    await AuditLog.create({
      actorId: adminId || "unknown",
      actorName: "Admin",
      role: "admin",
      action: "AI_COPILOT_QUERY",
      resource: "AiCopilot",
      resourceId: intentDetection.intent,
      status: "success",
      details: {
        query: query.substring(0, 200),
        intent: intentDetection.intent,
        confidence: intentDetection.confidence,
        latencyMs: Date.now() - startTime,
        isFallback,
      },
    });

    return response;
  } catch (error) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: adminId,
      endpoint: "/ai/copilot",
      input: query,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
