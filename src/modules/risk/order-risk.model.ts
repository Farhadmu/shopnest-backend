import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PaymentMethod = "cash_on_delivery" | "card" | "bank_transfer" | "mobile_banking";

export interface IRiskFactor {
  name: string;
  description: string;
  weight: number;
}

export interface IOrderRisk {
  _id: Types.ObjectId;
  orderId: string;
  userId: string;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: IRiskFactor[];
  requiresVerification: boolean;
  checkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const riskFactorSchema = new Schema<IRiskFactor>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const orderRiskSchema = new Schema<IOrderRisk>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ["cash_on_delivery", "card", "bank_transfer", "mobile_banking"],
      required: true,
      index: true,
    },
    riskLevel: { type: String, enum: ["low", "medium", "high", "critical"], required: true, index: true },
    riskScore: { type: Number, required: true, min: 0, max: 100 },
    factors: { type: [riskFactorSchema], required: true, default: [] },
    requiresVerification: { type: Boolean, required: true, default: false, index: true },
    checkedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

orderRiskSchema.index({ userId: 1, riskLevel: 1 });

applyToJSON(orderRiskSchema);

export const OrderRisk = model<IOrderRisk>("OrderRisk", orderRiskSchema);
