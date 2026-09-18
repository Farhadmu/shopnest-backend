import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type DeliveryIncidentCategory =
  | "customer_unavailable"
  | "wrong_address"
  | "customer_refused"
  | "cannot_contact_customer"
  | "access_problem"
  | "vehicle_problem"
  | "vehicle_breakdown"
  | "accident"
  | "package_issue"
  | "package_damaged"
  | "traffic"
  | "traffic_delay"
  | "severe_traffic"
  | "weather"
  | "severe_weather"
  | "seller_issue"
  | "safety_issue"
  | "technical_issue"
  | "other";

export type DeliveryIncidentStatus = "open" | "investigating" | "resolved" | "closed";

export interface IDeliveryIncident {
  _id: Types.ObjectId;
  deliveryRequestId?: string;
  reverseDeliveryRequestId?: string;
  returnRequestId?: string;
  orderId?: string;
  productId?: string;
  deliveryManId: string;
  category: DeliveryIncidentCategory;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidenceImages?: string[];
  status: DeliveryIncidentStatus;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryIncidentSchema = new Schema<IDeliveryIncident>(
  {
    deliveryRequestId: { type: String, index: true },
    reverseDeliveryRequestId: { type: String, index: true },
    returnRequestId: { type: String, index: true },
    orderId: { type: String, index: true },
    productId: { type: String, index: true },
    deliveryManId: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: [
        "customer_unavailable",
        "wrong_address",
        "customer_refused",
        "cannot_contact_customer",
        "access_problem",
        "vehicle_problem",
        "vehicle_breakdown",
        "accident",
        "package_issue",
        "package_damaged",
        "traffic",
        "traffic_delay",
        "severe_traffic",
        "weather",
        "severe_weather",
        "seller_issue",
        "safety_issue",
        "technical_issue",
        "other",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    description: { type: String, required: true },
    evidenceImages: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["open", "investigating", "resolved", "closed"],
      default: "open",
      index: true,
    },
    resolvedBy: { type: String },
    resolvedAt: { type: Date },
    resolutionNotes: { type: String },
  },
  { timestamps: true }
);

deliveryIncidentSchema.index({ deliveryManId: 1, status: 1 });
deliveryIncidentSchema.index({ orderId: 1 });

applyToJSON(deliveryIncidentSchema);

export const DeliveryIncident = model<IDeliveryIncident>("DeliveryIncident", deliveryIncidentSchema);
