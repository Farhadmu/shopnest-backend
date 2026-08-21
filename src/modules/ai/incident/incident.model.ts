import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../../utils/model-plugins";

export type AiIncidentType = "PROVIDER_ERROR" | "MALFORMED_OUTPUT" | "POSSIBLE_PROMPT_INJECTION" | "RATE_LIMITED";

export interface IAiIncident {
  _id: Types.ObjectId;
  type: AiIncidentType;
  userId?: string;
  endpoint: string;
  input?: string;
  error?: string;
  createdAt: Date;
}

const incidentSchema = new Schema<IAiIncident>(
  {
    type: {
      type: String,
      enum: ["PROVIDER_ERROR", "MALFORMED_OUTPUT", "POSSIBLE_PROMPT_INJECTION", "RATE_LIMITED"],
      required: true,
      index: true,
    },
    userId: { type: String, index: true },
    endpoint: { type: String, required: true },
    input: { type: String },
    error: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(incidentSchema);

export const AiIncident = model<IAiIncident>("AiIncident", incidentSchema);
