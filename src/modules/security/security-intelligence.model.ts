import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// 1. Active Device & Session Model
export interface IDeviceSession {
  _id: Types.ObjectId;
  userId: string;
  sessionToken: string;
  deviceName: string; // e.g. "Chrome on Windows 11"
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string;
  os: string;
  ipAddress: string;
  locationCity: string;
  isCurrentSession: boolean;
  isTrusted: boolean;
  status: "active" | "revoked" | "expired";
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const deviceSessionSchema = new Schema<IDeviceSession>(
  {
    userId: { type: String, required: true, index: true },
    sessionToken: { type: String, required: true, index: true },
    deviceName: { type: String, default: "Current Browser" },
    deviceType: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "unknown"],
      default: "desktop",
    },
    browser: { type: String, default: "Chrome" },
    os: { type: String, default: "Windows" },
    ipAddress: { type: String, default: "127.0.0.1" },
    locationCity: { type: String, default: "Dhaka, Bangladesh" },
    isCurrentSession: { type: Boolean, default: false },
    isTrusted: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["active", "revoked", "expired"],
      default: "active",
      index: true,
    },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applyToJSON(deviceSessionSchema);
export const DeviceSession = model<IDeviceSession>("DeviceSession", deviceSessionSchema);

// 2. Transaction & Login Risk Assessment Log
export interface ISecurityRiskLog {
  _id: Types.ObjectId;
  userId: string;
  contextType: "login" | "transaction" | "account_update" | "ato_check";
  riskScore: number; // 0 - 100
  riskLevel: "low" | "medium" | "high" | "critical";
  signals: string[];
  actionTaken: "allowed" | "step_up_required" | "flagged_for_review" | "blocked";
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const securityRiskLogSchema = new Schema<ISecurityRiskLog>(
  {
    userId: { type: String, required: true, index: true },
    contextType: {
      type: String,
      enum: ["login", "transaction", "account_update", "ato_check"],
      required: true,
    },
    riskScore: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low",
    },
    signals: { type: [String], default: [] },
    actionTaken: {
      type: String,
      enum: ["allowed", "step_up_required", "flagged_for_review", "blocked"],
      default: "allowed",
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applyToJSON(securityRiskLogSchema);
export const SecurityRiskLog = model<ISecurityRiskLog>("SecurityRiskLog", securityRiskLogSchema);
