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

const messageSchema = new Schema<IAiMessage>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    products: [
      {
        id: String,
        title: String,
        price: Number,
        category: String,
        position: Number,
      },
    ],
    orders: [
      {
        id: String,
        status: String,
        totalAmount: Number,
        position: Number,
      },
    ],
    contextReferences: [
      {
        id: String,
        type: String,
        title: String,
      },
    ],
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
