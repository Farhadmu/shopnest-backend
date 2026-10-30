import { Schema, model, Document, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type CustomerRiskLevel = "low" | "medium" | "high" | "critical";
export type CustomerTrustGrade = "A" | "B" | "C" | "D" | "F";

export interface ICustomerRiskFactor {
  code: string;
  name: string;
  description: string;
  weight: number;
  severity: CustomerRiskLevel;
  detectedAt?: Date;
}

export interface ICustomerFraudActivityLog {
  action: string;
  note: string;
  adminId?: string;
  at: Date;
}

export interface ICustomerFraudProfile extends Document {
  _id: Types.ObjectId;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  avatarUrl?: string;

  // Scoring
  riskScore: number; // 0 (Clean/Safe) to 100 (Critical Fraud)
  riskLevel: CustomerRiskLevel;
  trustGrade: CustomerTrustGrade;

  // Order Telemetry
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number; // RTO (Refused by customer / returned)
  refundedOrders: number;
  totalSpent: number;

  // Computed Ratios
  rtoRate: number; // Percentage 0 - 100
  cancellationRate: number; // Percentage 0 - 100
  fulfillmentRate: number; // Percentage 0 - 100

  // Enforcement Controls
  isCodRestricted: boolean; // Disables Cash on Delivery
  isBlacklisted: boolean; // Prevents placing any orders
  adminNotes?: string;

  // Breakdown & Tags
  riskFactors: ICustomerRiskFactor[];
  tags: string[];

  // Audit
  lastEvaluatedAt: Date;
  lastOrderAt?: Date;
  activityLogs: ICustomerFraudActivityLog[];
  createdAt: Date;
  updatedAt: Date;
}

const customerRiskFactorSchema = new Schema<ICustomerRiskFactor>(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], required: true },
    detectedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerFraudActivityLogSchema = new Schema<ICustomerFraudActivityLog>(
  {
    action: { type: String, required: true },
    note: { type: String, required: true },
    adminId: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerFraudProfileSchema = new Schema<ICustomerFraudProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    customerName: { type: String, default: "Anonymous Customer" },
    customerEmail: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },

    riskScore: { type: Number, required: true, default: 10, min: 0, max: 100, index: true },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
      default: "low",
      index: true,
    },
    trustGrade: {
      type: String,
      enum: ["A", "B", "C", "D", "F"],
      required: true,
      default: "A",
      index: true,
    },

    totalOrders: { type: Number, default: 0 },
    deliveredOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },
    returnedOrders: { type: Number, default: 0 },
    refundedOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },

    rtoRate: { type: Number, default: 0 },
    cancellationRate: { type: Number, default: 0 },
    fulfillmentRate: { type: Number, default: 100 },

    isCodRestricted: { type: Boolean, default: false, index: true },
    isBlacklisted: { type: Boolean, default: false, index: true },
    adminNotes: { type: String, default: "" },

    riskFactors: { type: [customerRiskFactorSchema], default: [] },
    tags: { type: [String], default: [] },

    lastEvaluatedAt: { type: Date, default: Date.now },
    lastOrderAt: { type: Date },
    activityLogs: { type: [customerFraudActivityLogSchema], default: [] },
  },
  { timestamps: true }
);

customerFraudProfileSchema.index({ riskScore: -1 });
customerFraudProfileSchema.index({ isCodRestricted: 1, riskLevel: 1 });
customerFraudProfileSchema.index({ customerEmail: 1, customerPhone: 1 });

applyToJSON(customerFraudProfileSchema);

export const CustomerFraudProfile = model<ICustomerFraudProfile>(
  "CustomerFraudProfile",
  customerFraudProfileSchema
);
