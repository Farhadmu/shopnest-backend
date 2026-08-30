import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface ICourierRateItem {
  weightRange: string;
  price: number;
}

export interface ICourierCoverage {
  zoneType: string;
  estimatedDays: number;
  rateStructure: ICourierRateItem[];
}

export interface ICourier {
  _id: Types.ObjectId;
  name: string;
  logo: string;
  trackingUrl: string;
  coverageAreas: ICourierCoverage[];
  rateStructure: ICourierRateItem[];
  estimatedDays: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courierRateItemSchema = new Schema<ICourierRateItem>(
  {
    weightRange: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const courierCoverageSchema = new Schema<ICourierCoverage>(
  {
    zoneType: { type: String, required: true },
    estimatedDays: { type: Number, required: true, min: 0 },
    rateStructure: { type: [courierRateItemSchema], required: true },
  },
  { _id: false }
);

const courierSchema = new Schema<ICourier>(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    logo: { type: String },
    trackingUrl: { type: String, required: true },
    coverageAreas: { type: [courierCoverageSchema], required: true, default: [] },
    rateStructure: { type: [courierRateItemSchema], required: true, default: [] },
    estimatedDays: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

courierSchema.index({ isActive: 1, name: 1 });

applyToJSON(courierSchema);

export const Courier = model<ICourier>("Courier", courierSchema);
