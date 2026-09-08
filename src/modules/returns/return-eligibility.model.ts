import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IReturnEligibility {
  _id: Types.ObjectId;
  orderId: string;
  productId: string;
  userId: string;
  isEligible: boolean;
  reason: string;
  returnWindowDays: number;
  daysSinceDelivery: number;
  requiredEvidence: string[];
  refundMethod: string;
  estimatedProcessingDays: number;
  checkedAt: Date;
}

const returnEligibilitySchema = new Schema<IReturnEligibility>(
  {
    orderId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    isEligible: { type: Boolean, required: true },
    reason: { type: String, required: true },
    returnWindowDays: { type: Number, required: true, min: 0 },
    daysSinceDelivery: { type: Number, required: true, min: 0 },
    requiredEvidence: { type: [String], required: true, default: [] },
    refundMethod: { type: String, required: true },
    estimatedProcessingDays: { type: Number, required: true, min: 0 },
    checkedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

returnEligibilitySchema.index({ orderId: 1, productId: 1 });
returnEligibilitySchema.index({ userId: 1, isEligible: 1 });

applyToJSON(returnEligibilitySchema);

export const ReturnEligibility = model<IReturnEligibility>("ReturnEligibility", returnEligibilitySchema);
