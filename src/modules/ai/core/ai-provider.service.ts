import {
  completeWithContext,
  ChatMessage,
  CompleteResult,
  AiContext as ProviderAiContext,
} from "../providers/claude.provider";
import { AIContext, AIEvidence } from "./ai-types";
import { AiEvidenceService } from "./ai-evidence.service";
import { logger } from "../../../utils/logger";

export interface ProviderExecutionResult {
  content: string;
  provider: string;
  isFallback: boolean;
  durationMs: number;
}

export class AiProviderService {
  /**
   * Dispatches conversation messages to the active 4-tier provider stack with database grounding
   */
  public static async executeCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    context: AIContext,
    evidence: AIEvidence[] = []
  ): Promise<ProviderExecutionResult> {
    const startTime = Date.now();

    // Append verified database evidence to system instructions
    const evidenceBlock = AiEvidenceService.formatForPrompt(evidence);
    const enrichedSystemPrompt = `${systemPrompt}\n\n${evidenceBlock}`.trim();

    // Map internal context to provider context format
    const providerContext: ProviderAiContext = {
      userContext: {
        role: context.role,
        aiType: context.aiType,
        userId: context.userId,
        sellerId: context.sellerId,
        permissions: context.permissions,
        locale: context.locale,
      },
    };

    try {
      const result: CompleteResult = await completeWithContext(messages, providerContext, {
        system: enrichedSystemPrompt,
        role: context.role === "guest" ? "customer" : context.role === "delivery_man" ? "customer" : context.role,
      });

      const durationMs = Date.now() - startTime;
      logger.info("[UnifiedAiProvider] Completion generated", {
        provider: result.provider || (result.isFallback ? "deterministic_fallback" : "unknown"),
        durationMs,
        isFallback: result.isFallback,
      });

      return {
        content: result.content,
        provider: result.provider || (result.isFallback ? "deterministic_database_rule_engine" : "primary_provider"),
        isFallback: result.isFallback,
        durationMs,
      };
    } catch (err: any) {
      logger.error("[UnifiedAiProvider] Provider call failed; returning deterministic response", {
        error: err?.message,
      });

      return {
        content: "I have gathered verified data from ShopNest. Please review the details below.",
        provider: "deterministic_database_rule_engine",
        isFallback: true,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
