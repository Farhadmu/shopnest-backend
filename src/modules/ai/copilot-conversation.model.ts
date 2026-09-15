import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface ICopilotMessage {
  role: "user" | "assistant";
  content: string;
  at: Date;
}

export interface ICopilotConversation {
  _id: Types.ObjectId;
  userId: string;
  role: "seller" | "customer";
  messages: ICopilotMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const copilotMessageSchema = new Schema<ICopilotMessage>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const copilotConversationSchema = new Schema<ICopilotConversation>(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["seller", "customer"], required: true, index: true },
    messages: { type: [copilotMessageSchema], default: [] },
  },
  { timestamps: true }
);

copilotConversationSchema.index({ userId: 1, role: 1, createdAt: -1 });

applyToJSON(copilotConversationSchema);

export const CopilotConversation = model<ICopilotConversation>("CopilotConversation", copilotConversationSchema);
