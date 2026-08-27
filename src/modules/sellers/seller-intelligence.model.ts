import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// 1. Seller Goal & KPI System
export interface ISellerGoal {
  _id: Types.ObjectId;
  sellerId: string;
  storeId: string;
  title: string;
  metricType: "revenue" | "orders" | "rating" | "products" | "fulfillment_rate";
  targetValue: number;
  currentValue: number;
  unit: string;
  period: "monthly" | "quarterly" | "annual";
  deadline: Date;
  status: "in_progress" | "achieved" | "missed";
  recommendations: string[];
  createdAt: Date;
  updatedAt: Date;
}

const sellerGoalSchema = new Schema<ISellerGoal>(
  {
    sellerId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    metricType: {
      type: String,
      enum: ["revenue", "orders", "rating", "products", "fulfillment_rate"],
      required: true,
    },
    targetValue: { type: Number, required: true, min: 0 },
    currentValue: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "৳" },
    period: { type: String, enum: ["monthly", "quarterly", "annual"], default: "monthly" },
    deadline: { type: Date, required: true },
    status: {
      type: String,
      enum: ["in_progress", "achieved", "missed"],
      default: "in_progress",
    },
    recommendations: { type: [String], default: [] },
  },
  { timestamps: true }
);

applyToJSON(sellerGoalSchema);
export const SellerGoal = model<ISellerGoal>("SellerGoal", sellerGoalSchema);

// 2. Seller A/B Testing Experiments
export interface IAbExperimentVariant {
  name: string; // "A" or "B"
  value: string; // e.g. "Original Title" or "AI Optimized Title"
  views: number;
  clicks: number;
  cartAdds: number;
  orders: number;
  revenue: number;
  conversionRate: number;
}

export interface IAbExperiment {
  _id: Types.ObjectId;
  sellerId: string;
  storeId: string;
  productId: string;
  productTitle: string;
  testType: "title" | "description" | "image" | "pricing" | "cta";
  variantA: IAbExperimentVariant;
  variantB: IAbExperimentVariant;
  status: "active" | "paused" | "completed";
  winner?: "variantA" | "variantB" | "inconclusive";
  confidenceScore: number; // 0 - 100
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<IAbExperimentVariant>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    cartAdds: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
  },
  { _id: false }
);

const abExperimentSchema = new Schema<IAbExperiment>(
  {
    sellerId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    testType: {
      type: String,
      enum: ["title", "description", "image", "pricing", "cta"],
      default: "title",
    },
    variantA: { type: variantSchema, required: true },
    variantB: { type: variantSchema, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "completed"],
      default: "active",
      index: true,
    },
    winner: { type: String, enum: ["variantA", "variantB", "inconclusive"] },
    confidenceScore: { type: Number, default: 50, min: 0, max: 100 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
  },
  { timestamps: true }
);

applyToJSON(abExperimentSchema);
export const AbExperiment = model<IAbExperiment>("AbExperiment", abExperimentSchema);
