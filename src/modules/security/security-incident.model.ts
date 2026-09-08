import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
  | "new"
  | "open"
  | "acknowledged"
  | "investigating"
  | "mitigated"
  | "resolved"
  | "closed"
  | "dismissed"
  | "reopened";

export type IncidentType =
  | "suspicious_login"
  | "account_takeover"
  | "authentication_anomaly"
  | "api_abuse"
  | "rate_limit_abuse"
  | "payment_security_anomaly"
  | "fraud_pattern"
  | "seller_security_incident"
  | "suspicious_order_activity"
  | "session_anomaly"
  | "data_access_anomaly"
  | "system_security_incident"
  | "other";

export type IncidentSource = "manual" | "suspicious_activity" | "anomaly" | "risk_signal" | "security_log";

export interface IIncidentNote {
  authorId: string;
  authorName: string;
  note: string;
  createdAt: Date;
}

export interface IIncidentHistoryItem {
  action: string;
  changedBy: string;
  timestamp: Date;
  details?: string;
}

export interface IAssignedAdmin {
  adminId: string;
  adminName: string;
  assignedAt: Date;
}

export interface IEvidence {
  description: string;
  reference: string;
  addedBy: string;
  addedAt: Date;
}

export interface ISecurityIncident {
  _id: Types.ObjectId;
  incidentCode: string;
  title: string;
  description: string;
  type: IncidentType;
  source: IncidentSource;
  entityType: "user" | "seller" | "order" | "system" | "ip_cluster";
  entityId: string;
  entityName: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  riskScore: number;
  signals: string[];
  assignedAdmin?: IAssignedAdmin;
  detectedAt: Date;
  acknowledgedAt?: Date;
  investigationStartedAt?: Date;
  mitigatedAt?: Date;
  mitigatedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionSummary?: string;
  closedAt?: Date;
  closedBy?: string;
  closeReason?: string;
  evidence: IEvidence[];
  notes: IIncidentNote[];
  history: IIncidentHistoryItem[];
  relatedSecurityEvents: Types.ObjectId[];
  relatedRiskSignals: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const incidentNoteSchema = new Schema<IIncidentNote>(
  {
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    note: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const incidentHistorySchema = new Schema<IIncidentHistoryItem>(
  {
    action: { type: String, required: true },
    changedBy: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    details: { type: String },
  },
  { _id: false }
);

const assignedAdminSchema = new Schema<IAssignedAdmin>(
  {
    adminId: { type: String, required: true },
    adminName: { type: String, required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const evidenceSchema = new Schema<IEvidence>(
  {
    description: { type: String, required: true },
    reference: { type: String, required: true },
    addedBy: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const securityIncidentSchema = new Schema<ISecurityIncident>(
  {
    incidentCode: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    type: {
      type: String,
      enum: [
        "suspicious_login",
        "account_takeover",
        "authentication_anomaly",
        "api_abuse",
        "rate_limit_abuse",
        "payment_security_anomaly",
        "fraud_pattern",
        "seller_security_incident",
        "suspicious_order_activity",
        "session_anomaly",
        "data_access_anomaly",
        "system_security_incident",
        "other",
      ],
      default: "other",
      index: true,
    },
    source: {
      type: String,
      enum: ["manual", "suspicious_activity", "anomaly", "risk_signal", "security_log"],
      default: "manual",
      index: true,
    },
    entityType: {
      type: String,
      enum: ["user", "seller", "order", "system", "ip_cluster"],
      required: true,
      index: true,
    },
    entityId: { type: String, required: true, index: true },
    entityName: { type: String, required: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["new", "open", "acknowledged", "investigating", "mitigated", "resolved", "closed", "dismissed", "reopened"],
      default: "new",
      index: true,
    },
    riskScore: { type: Number, default: 65, min: 0, max: 100, index: true },
    signals: { type: [String], default: [] },
    assignedAdmin: { type: assignedAdminSchema, default: undefined },
    detectedAt: { type: Date, default: Date.now, index: true },
    acknowledgedAt: { type: Date },
    investigationStartedAt: { type: Date },
    mitigatedAt: { type: Date },
    mitigatedBy: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionSummary: { type: String },
    closedAt: { type: Date },
    closedBy: { type: String },
    closeReason: { type: String },
    evidence: { type: [evidenceSchema], default: [] },
    notes: { type: [incidentNoteSchema], default: [] },
    history: { type: [incidentHistorySchema], default: [] },
    relatedSecurityEvents: { type: [Schema.Types.ObjectId], ref: "SecurityLog", default: [] },
    relatedRiskSignals: { type: [Schema.Types.ObjectId], ref: "AnomalyLog", default: [] },
  },
  { timestamps: true }
);

applyToJSON(securityIncidentSchema);
export const SecurityIncident = model<ISecurityIncident>("SecurityIncident", securityIncidentSchema);
