import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type DeliveryZoneType = "inside_dhaka" | "outside_dhaka" | "remote" | "custom";

export interface IDeliveryZone {
  _id: Types.ObjectId;
  name: string;
  type: DeliveryZoneType;
  divisions: string[];
  districts: string[];
  upazilas: string[];
  estimatedDays: number;
  baseFee: number;
  perKmFee: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryZoneSchema = new Schema<IDeliveryZone>(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["inside_dhaka", "outside_dhaka", "remote", "custom"], required: true, index: true },
    divisions: { type: [String], required: true },
    districts: { type: [String], required: true },
    upazilas: { type: [String], default: [] },
    estimatedDays: { type: Number, required: true, min: 0 },
    baseFee: { type: Number, required: true, min: 0 },
    perKmFee: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

deliveryZoneSchema.index({ type: 1, isActive: 1 });

applyToJSON(deliveryZoneSchema);

export const DeliveryZone = model<IDeliveryZone>("DeliveryZone", deliveryZoneSchema);
