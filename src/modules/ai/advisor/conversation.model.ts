import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../../utils/model-plugins";
import { ConversationState } from "./conversation-state";

export interface IAiMessage {
  role: "user" | "assistant";
  content: string;
  at: Date;
  // Structured data attached to assistant messages
  products?: Array<{
    id: string;
    title: string;
    price: number;
    category: string;
    position: number;
  }>;
  orders?: Array<{
    id: string;
    status: string;
    totalAmount: number;
    position: number;
  }>;
  contextReferences?: Array<{
    id: string;
    type: string;
    title: string;
  }>;
}

export interface IAiConversation {
  _id: Types.ObjectId;
  userId: string;
  messages: IAiMessage[];
  // Persisted conversation state for multi-turn reasoning
  conversationState: ConversationState;
  // Turn counter
  turnCount: number;
  // Last activity
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type PersistedProductReference = NonNullable<IAiMessage["products"]>[number];
type PersistedOrderReference = NonNullable<IAiMessage["orders"]>[number];
type PersistedContextReference = NonNullable<IAiMessage["contextReferences"]>[number];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProductReferences(value: unknown): PersistedProductReference[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const products = value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) return [];

    const id = asString(item.id);
    const title = asString(item.title);
    const price = asFiniteNumber(item.price);
    const category = asString(item.category);
    const position = asFiniteNumber(item.position);

    return id && title && price !== null && category && position !== null
      ? [{ id, title, price, category, position }]
      : [];
  });

  return products.length > 0 ? products : undefined;
}

function normalizeOrderReferences(value: unknown): PersistedOrderReference[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const orders = value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) return [];

    const id = asString(item.id);
    const status = asString(item.status);
    const totalAmount = asFiniteNumber(item.totalAmount);
    const position = asFiniteNumber(item.position);

    return id && status && totalAmount !== null && position !== null
      ? [{ id, status, totalAmount, position }]
      : [];
  });

  return orders.length > 0 ? orders : undefined;
}

function normalizeContextReferences(value: unknown): PersistedContextReference[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const references = value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) return [];

    const id = asString(item.id);
    const type = asString(item.type);
    const title = asString(item.title);

    return id && type && title ? [{ id, type, title }] : [];
  });

  return references.length > 0 ? references : undefined;
}

/**
 * Converts legacy or malformed message metadata to the current safe storage
 * shape. Conversations created before contextReferences became a subdocument
 * array can otherwise fail validation on their next save.
 */
export function sanitizeAiConversationMessages(messages: unknown[]): IAiMessage[] {
  return messages.flatMap((entry) => {
    const raw = asRecord(entry);
    if (!raw) return [];

    const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
    const content = asString(raw.content);
    if (!role || !content) return [];

    const at = raw.at instanceof Date ? raw.at : new Date(raw.at as string | number | Date);
    const message: IAiMessage = {
      role,
      content,
      at: Number.isNaN(at.getTime()) ? new Date() : at,
    };

    const products = normalizeProductReferences(raw.products);
    const orders = normalizeOrderReferences(raw.orders);
    const contextReferences = normalizeContextReferences(raw.contextReferences);

    if (products) message.products = products;
    if (orders) message.orders = orders;
    if (contextReferences) message.contextReferences = contextReferences;

    return [message];
  });
}

// `type` is a reserved Mongoose schema option when it appears in an inline
// object definition. Keep this as an explicit sub-schema so references such
// as { id, type: "product", title } are persisted as objects, not strings.
const contextReferenceSchema = new Schema<{ id: string; type: string; title: string }>(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
  },
  { _id: false }
);

const productReferenceSchema = new Schema<NonNullable<IAiMessage["products"]>[number]>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    position: { type: Number, required: true },
  },
  { _id: false }
);

const orderReferenceSchema = new Schema<NonNullable<IAiMessage["orders"]>[number]>(
  {
    id: { type: String, required: true },
    status: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    position: { type: Number, required: true },
  },
  { _id: false }
);

const messageSchema = new Schema<IAiMessage>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    products: { type: [productReferenceSchema], default: undefined },
    orders: { type: [orderReferenceSchema], default: undefined },
    contextReferences: { type: [contextReferenceSchema], default: undefined },
  },
  { _id: false }
);

const conversationSchema = new Schema<IAiConversation>(
  {
    userId: { type: String, required: true, index: true },
    messages: { type: [messageSchema], default: [] },
    conversationState: {
      type: Schema.Types.Mixed,
      default: () => ({
        currentTopic: null,
        currentIntent: null,
        productContext: null,
        referencedProducts: [],
        referencedOrders: [],
        conversationPhase: "greeting",
        pendingClarification: null,
        userPreferences: {
          prefersBudgetOptions: false,
          prefersPremiumOptions: false,
          mentionedUseCases: [],
          frequentCategories: [],
          language: null,
        },
        topicHistory: [],
        lastUpdateTurn: 0,
      }),
    },
    turnCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

conversationSchema.index({ userId: 1, lastActiveAt: -1 });
conversationSchema.index({ userId: 1, createdAt: -1 });

// Update lastActiveAt on every save
conversationSchema.pre("save", function (next) {
  this.lastActiveAt = new Date();
  next();
});

applyToJSON(conversationSchema);

export const AiConversation = model<IAiConversation>("AiConversation", conversationSchema);
