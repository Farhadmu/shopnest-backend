import { Schema, model, Types, Document } from "mongoose";

export interface IVisualSearchDemand extends Document {
  imageUrl: string;
  searchQuery?: string;
  detectedTitle: string;
  detectedCategory: string;
  detectedBrand?: string;
  detectedColor?: string;
  detectedFeatures: string[];
  detectedTags: string[];
  confidence: "high" | "medium" | "low";
  matchedCount: number;
  matchedProductIds: Types.ObjectId[];
  isUnmetDemand: boolean;
  userId?: string;
  userRole: "guest" | "customer";
  searchCount: number;
  status: "new" | "reviewed" | "stocked";
  createdAt: Date;
  updatedAt: Date;
}

const visualSearchDemandSchema = new Schema<IVisualSearchDemand>(
  {
    imageUrl: { type: String, required: true, trim: true },
    searchQuery: { type: String, trim: true, default: "" },
    detectedTitle: { type: String, required: true, trim: true, index: true },
    detectedCategory: { type: String, required: true, trim: true, index: true },
    detectedBrand: { type: String, trim: true, default: "" },
    detectedColor: { type: String, trim: true, default: "" },
    detectedFeatures: { type: [String], default: [] },
    detectedTags: { type: [String], default: [], index: true },
    confidence: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    matchedCount: { type: Number, default: 0, index: true },
    matchedProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    isUnmetDemand: { type: Boolean, default: false, index: true },
    userId: { type: String, default: null },
    userRole: { type: String, enum: ["guest", "customer"], default: "guest" },
    searchCount: { type: Number, default: 1 },
    status: { type: String, enum: ["new", "reviewed", "stocked"], default: "new", index: true },
  },
  {
    timestamps: true,
  }
);

visualSearchDemandSchema.index({ createdAt: -1 });
visualSearchDemandSchema.index({ detectedCategory: 1, isUnmetDemand: 1, createdAt: -1 });

export const VisualSearchDemand = model<IVisualSearchDemand>(
  "VisualSearchDemand",
  visualSearchDemandSchema
);
