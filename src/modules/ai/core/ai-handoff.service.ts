import { AIExperience, AIHandoffContext } from "./ai-types";

// In-memory safe TTL cache for active handoff envelopes (15-minute expiration)
const handoffStore = new Map<string, AIHandoffContext>();

export class AiHandoffService {
  /**
   * Initiates a safe handoff between two AI experiences
   */
  public static createHandoff(params: {
    from: AIExperience;
    to: AIExperience;
    userId?: string;
    productIds?: string[];
    orderIds?: string[];
    deliveryIds?: string[];
    conversationSummary?: string;
    suggestedAction?: string;
    preferences?: Record<string, unknown>;
  }): AIHandoffContext {
    const handoffId = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins

    const envelope: AIHandoffContext = {
      handoffId,
      from: params.from,
      to: params.to,
      userId: params.userId,
      productIds: params.productIds || [],
      orderIds: params.orderIds || [],
      deliveryIds: params.deliveryIds || [],
      conversationSummary: params.conversationSummary || "Context transferred from previous AI session.",
      suggestedAction: params.suggestedAction || "Review selected item with Customer Copilot",
      preferences: params.preferences || {},
      createdAt: now,
      expiresAt,
    };

    handoffStore.set(handoffId, envelope);
    return envelope;
  }

  /**
   * Consumes a handoff context token
   */
  public static consumeHandoff(handoffId: string): AIHandoffContext | null {
    const envelope = handoffStore.get(handoffId);
    if (!envelope) return null;

    if (new Date() > envelope.expiresAt) {
      handoffStore.delete(handoffId);
      return null;
    }

    // Single-use guarantee
    handoffStore.delete(handoffId);
    return envelope;
  }
}

// Handoff envelope TTL constraint (15 minutes in milliseconds)
export const HANDOFF_ENVELOPE_TTL_MS = 15 * 60 * 1000;
