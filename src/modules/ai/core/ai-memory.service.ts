import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../../utils/model-plugins";
import { AIExperience, UserRole } from "./ai-types";

export interface IMemoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: Date;
  evidenceSummary?: string;
  referencedEntities?: {
    productIds?: string[];
    orderIds?: string[];
    deliveryIds?: string[];
  };
}

export interface IUnifiedAiConversation {
  _id: Types.ObjectId;
  userId?: string;
  sessionId?: string;
  role: UserRole;
  aiType: AIExperience;
  topicHistory: string[];
  currentTopic?: string;
  preferences: Record<string, unknown>;
  messages: IMemoryMessage[];
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const memoryMessageSchema = new Schema<IMemoryMessage>(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    evidenceSummary: { type: String },
    referencedEntities: {
      productIds: [{ type: String }],
      orderIds: [{ type: String }],
      deliveryIds: [{ type: String }],
    },
  },
  { _id: false }
);

const unifiedAiConversationSchema = new Schema<IUnifiedAiConversation>(
  {
    userId: { type: String, index: true },
    sessionId: { type: String, index: true },
    role: { type: String, enum: ["customer", "seller", "admin", "delivery_man", "guest"], required: true },
    aiType: {
      type: String,
      enum: ["ADVISOR", "CUSTOMER_COPILOT", "SELLER_COPILOT", "ADMIN_COPILOT", "DELIVERY_COPILOT"],
      required: true,
    },
    topicHistory: [{ type: String }],
    currentTopic: { type: String },
    preferences: { type: Map, of: Schema.Types.Mixed, default: {} },
    messages: { type: [memoryMessageSchema], default: [] },
    lastActiveAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

unifiedAiConversationSchema.index({ userId: 1, aiType: 1, updatedAt: -1 });
unifiedAiConversationSchema.index({ sessionId: 1, aiType: 1, updatedAt: -1 });

applyToJSON(unifiedAiConversationSchema);

export const UnifiedAiConversation = model<IUnifiedAiConversation>(
  "UnifiedAiConversation",
  unifiedAiConversationSchema
);

export class AiMemoryService {
  /**
   * Loads or creates a conversation record for user or guest session
   */
  public static async getOrCreateConversation(
    aiType: AIExperience,
    role: UserRole,
    userId?: string,
    conversationId?: string,
    sessionId?: string
  ): Promise<IUnifiedAiConversation> {
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      const existing = await UnifiedAiConversation.findById(conversationId);
      if (existing) return existing;
    }

    if (userId) {
      const recent = await UnifiedAiConversation.findOne({ userId, aiType }).sort({ updatedAt: -1 });
      if (recent) return recent;
    }

    const created = await UnifiedAiConversation.create({
      userId,
      sessionId: sessionId || `guest-${Date.now()}`,
      role,
      aiType,
      topicHistory: [],
      preferences: {},
      messages: [],
      lastActiveAt: new Date(),
    });

    return created;
  }

  /**
   * Appends user and assistant messages with referenced entities
   */
  public static async recordTurn(
    conversationId: string,
    userPrompt: string,
    assistantReply: string,
    meta?: {
      evidenceSummary?: string;
      productIds?: string[];
      orderIds?: string[];
      deliveryIds?: string[];
      detectedTopic?: string;
    }
  ): Promise<void> {
    if (!conversationId || !Types.ObjectId.isValid(conversationId)) return;

    const conv = await UnifiedAiConversation.findById(conversationId);
    if (!conv) return;

    conv.messages.push({
      role: "user",
      content: userPrompt,
      at: new Date(),
    });

    conv.messages.push({
      role: "assistant",
      content: assistantReply,
      at: new Date(),
      evidenceSummary: meta?.evidenceSummary,
      referencedEntities: {
        productIds: meta?.productIds,
        orderIds: meta?.orderIds,
        deliveryIds: meta?.deliveryIds,
      },
    });

    // Limit in-memory message history to 20 messages for prompt efficiency
    if (conv.messages.length > 24) {
      conv.messages = conv.messages.slice(-24);
    }

    if (meta?.detectedTopic) {
      if (conv.currentTopic && conv.currentTopic !== meta.detectedTopic) {
        conv.topicHistory.push(conv.currentTopic);
      }
      conv.currentTopic = meta.detectedTopic;
    }

    conv.lastActiveAt = new Date();
    await conv.save();
  }

  /**
   * Resolves common conversational references like "the second one", "that laptop", "cheaper one"
   */
  public static resolveEntityReference(
    userPrompt: string,
    recentProducts?: Array<{ id: string; title: string; price: number }>
  ): { targetProductId?: string; reason?: string } | null {
    if (!recentProducts || recentProducts.length === 0) return null;
    const lower = userPrompt.toLowerCase();

    // Positional references
    if (lower.includes("first one") || lower.includes("1st one") || lower.includes("number 1") || lower.includes("prothom ta")) {
      return { targetProductId: recentProducts[0]?.id, reason: "1st item in shown list" };
    }
    if (lower.includes("second one") || lower.includes("2nd one") || lower.includes("number 2") || lower.includes("ditiyo ta")) {
      return { targetProductId: recentProducts[1]?.id, reason: "2nd item in shown list" };
    }
    if (lower.includes("third one") || lower.includes("3rd one") || lower.includes("number 3") || lower.includes("tritiyo ta")) {
      return { targetProductId: recentProducts[2]?.id, reason: "3rd item in shown list" };
    }

    // Price comparison references
    if (lower.includes("cheaper") || lower.includes("cheapest") || lower.includes("lowest price") || lower.includes("kom dami")) {
      const sorted = [...recentProducts].sort((a, b) => a.price - b.price);
      return { targetProductId: sorted[0]?.id, reason: "lowest price option" };
    }
    if (lower.includes("expensive") || lower.includes("premium") || lower.includes("highest price") || lower.includes("dam beshi")) {
      const sorted = [...recentProducts].sort((a, b) => b.price - a.price);
      return { targetProductId: sorted[0]?.id, reason: "highest price option" };
    }

    return null;
  }
}
