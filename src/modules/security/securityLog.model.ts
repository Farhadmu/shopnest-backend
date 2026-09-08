import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type SecurityEventType =
  | "SUSPICIOUS_ORDER"
  | "LOGIN_ANOMALY"
  | "RATE_LIMIT_BREACH"
  | "ADMIN_ACTION"
  | "AI_MISUSE";

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export interface ISecurityLog {
  _id: Types.ObjectId;
  type: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  ip?: string;
  message: string;
  details?: unknown;
  resolved: boolean;
  createdAt: Date;
}

const securityLogSchema = new Schema<ISecurityLog>(
  {
    type: {
      type: String,
      enum: ["SUSPICIOUS_ORDER", "LOGIN_ANOMALY", "RATE_LIMIT_BREACH", "ADMIN_ACTION", "AI_MISUSE"],
      required: true,
      index: true,
    },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "low", index: true },
    userId: { type: String, index: true },
    ip: { type: String },
    message: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
    resolved: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(securityLogSchema);

export const SecurityLog = model<ISecurityLog>("SecurityLog", securityLogSchema);
