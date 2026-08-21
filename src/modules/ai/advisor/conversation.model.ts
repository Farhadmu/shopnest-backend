import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../../utils/model-plugins";

export interface IAiMessage {
  role: "user" | "assistant";
  content: string;
  at: Date;
}

export interface IAiConversation {
  _id: Types.ObjectId;
  userId: string;
  messages: IAiMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IAiMessage>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const conversationSchema = new Schema<IAiConversation>(
  {
    userId: { type: String, required: true, index: true },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

applyToJSON(conversationSchema);

export const AiConversation = model<IAiConversation>("AiConversation", conversationSchema);
