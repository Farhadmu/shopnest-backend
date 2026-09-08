import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// 1. Marketplace Anomaly Event Model
export interface IAnomalyLog {
  _id: Types.ObjectId;
  entityType: "seller" | "product" | "category" | "coupon" | "payment";
  entityId: string;
  entityName: string;
  anomalyType:
    | "unusual_order_spike"
    | "review_velocity_surge"
    | "cancellation_spike"
    | "price_anomaly"
    | "coupon_abuse_pattern"
    | "refund_leakage";
  severity: "low" | "medium" | "high" | "critical";
  riskScore: number; // 0 - 100
  evidence: string;
  recommendedAction: string;
  status: "detected" | "under_review" | "resolved" | "dismissed";
  detectedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
}

const anomalyLogSchema = new Schema<IAnomalyLog>(
  {
    entityType: {
      type: String,
      enum: ["seller", "product", "category", "coupon", "payment"],
      required: true,
      index: true,
    },
    entityId: { type: String, required: true },
    entityName: { type: String, required: true },
    anomalyType: {
      type: String,
      enum: [
        "unusual_order_spike",
        "review_velocity_surge",
        "cancellation_spike",
        "price_anomaly",
        "coupon_abuse_pattern",
        "refund_leakage",
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    riskScore: { type: Number, default: 50, min: 0, max: 100 },
    evidence: { type: String, required: true },
    recommendedAction: { type: String, required: true },
    status: {
      type: String,
      enum: ["detected", "under_review", "resolved", "dismissed"],
      default: "detected",
      index: true,
    },
    detectedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionNotes: { type: String },
  },
  { timestamps: true }
);

applyToJSON(anomalyLogSchema);
export const AnomalyLog = model<IAnomalyLog>("AnomalyLog", anomalyLogSchema);

// 2. System API Telemetry & Incident Log
export interface ISystemTelemetry {
  _id: Types.ObjectId;
  endpoint: string;
  serviceName: string;
  responseTimeMs: number;
  statusCode: number;
  errorRate: number;
  status: "healthy" | "degraded" | "critical";
  timestamp: Date;
}

const systemTelemetrySchema = new Schema<ISystemTelemetry>(
  {
    endpoint: { type: String, required: true, index: true },
    serviceName: { type: String, required: true },
    responseTimeMs: { type: Number, required: true },
    statusCode: { type: Number, required: true },
    errorRate: { type: Number, default: 0 },
    status: { type: String, enum: ["healthy", "degraded", "critical"], default: "healthy" },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applyToJSON(systemTelemetrySchema);
export const SystemTelemetry = model<ISystemTelemetry>("SystemTelemetry", systemTelemetrySchema);
