import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

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

export interface ISecurityIncident {
  _id: Types.ObjectId;
  incidentCode: string;
  title: string;
  entityType: "user" | "seller" | "order" | "system" | "ip_cluster";
  entityId: string;
  entityName: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "new" | "investigating" | "resolved" | "dismissed";
  riskScore: number;
  signals: string[];
  notes: IIncidentNote[];
  history: IIncidentHistoryItem[];
  resolvedAt?: Date;
  resolvedBy?: string;
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

const securityIncidentSchema = new Schema<ISecurityIncident>(
  {
    incidentCode: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
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
      enum: ["new", "investigating", "resolved", "dismissed"],
      default: "new",
      index: true,
    },
    riskScore: { type: Number, default: 65, min: 0, max: 100 },
    signals: { type: [String], default: [] },
    notes: { type: [incidentNoteSchema], default: [] },
    history: { type: [incidentHistorySchema], default: [] },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
  },
  { timestamps: true }
);

applyToJSON(securityIncidentSchema);
export const SecurityIncident = model<ISecurityIncident>("SecurityIncident", securityIncidentSchema);
