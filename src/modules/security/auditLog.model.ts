import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IAuditLog {
  _id: Types.ObjectId;
  actorId: string;
  actorName: string;
  role: "customer" | "seller" | "admin" | "system";
  action: string; // e.g. "APPROVED_SELLER", "SUSPENDED_PRODUCT", "UPDATED_SETTINGS", "LOGIN_SUCCESS"
  resource: string; // e.g. "Store", "Product", "User", "Order", "Security"
  resourceId?: string;
  status: "success" | "warning" | "failure";
  ip?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: String, required: true, index: true },
    actorName: { type: String, required: true },
    role: {
      type: String,
      enum: ["customer", "seller", "admin", "system"],
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String },
    status: { type: String, enum: ["success", "warning", "failure"], default: "success", index: true },
    ip: { type: String, default: "127.0.0.1" },
    details: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(auditLogSchema);
export const AuditLog = model<IAuditLog>("AuditLog", auditLogSchema);
