import { Schema, model, Document } from "mongoose";

export interface IVisualSearchHistory extends Document {
  userId: string;
  imageUrl: string;
  detectedTitle: string;
  detectedCategory: string;
  detectedProductType?: string;
  resultCount: number;
  searchQuery?: string;
  createdAt: Date;
}

const visualSearchHistorySchema = new Schema<IVisualSearchHistory>(
  {
    userId: { type: String, required: true, index: true },
    imageUrl: { type: String, required: true, trim: true },
    detectedTitle: { type: String, required: true, trim: true },
    detectedCategory: { type: String, required: true, trim: true },
    detectedProductType: { type: String, trim: true },
    resultCount: { type: Number, default: 0 },
    searchQuery: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

visualSearchHistorySchema.index({ userId: 1, createdAt: -1 });
// 30-day automatic retention policy (TTL)
visualSearchHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const VisualSearchHistory = model<IVisualSearchHistory>(
  "VisualSearchHistory",
  visualSearchHistorySchema
);
