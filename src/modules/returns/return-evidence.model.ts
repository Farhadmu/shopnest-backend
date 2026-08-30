import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type ReturnIssueType =
  | "wrong_item"
  | "damaged"
  | "defective"
  | "not_as_described"
  | "size_issue"
  | "missing_parts"
  | "other";

export type EvidenceStatus = "pending" | "approved" | "rejected";

export interface IReturnEvidence {
  _id: Types.ObjectId;
  returnId: string;
  orderId: string;
  userId: string;
  productId: string;
  images: string[];
  videos: string[];
  description: string;
  issueType: ReturnIssueType;
  submittedAt: Date;
  reviewedAt?: Date;
  status: EvidenceStatus;
  createdAt: Date;
  updatedAt: Date;
}

const returnEvidenceSchema = new Schema<IReturnEvidence>(
  {
    returnId: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    images: { type: [String], default: [] },
    videos: { type: [String], default: [] },
    description: { type: String, required: true },
    issueType: {
      type: String,
      enum: ["wrong_item", "damaged", "defective", "not_as_described", "size_issue", "missing_parts", "other"],
      required: true,
    },
    submittedAt: { type: Date, required: true, default: Date.now },
    reviewedAt: { type: Date },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  },
  { timestamps: true }
);

returnEvidenceSchema.index({ orderId: 1, productId: 1 });
returnEvidenceSchema.index({ userId: 1, status: 1 });

applyToJSON(returnEvidenceSchema);

export const ReturnEvidence = model<IReturnEvidence>("ReturnEvidence", returnEvidenceSchema);
