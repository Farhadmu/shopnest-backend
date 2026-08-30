import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IAddress {
  _id: Types.ObjectId;
  userId: string;
  title: string;
  fullName: string;
  phone: string;
  division: string;
  district: string;
  upazila: string;
  area: string;
  unionWard?: string;
  road?: string;
  house?: string;
  landmark?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    upazila: { type: String, required: true },
    area: { type: String, required: true },
    unionWard: { type: String },
    road: { type: String },
    house: { type: String },
    landmark: { type: String },
    isDefault: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

addressSchema.index({ userId: 1, isDefault: 1 });
addressSchema.index({ userId: 1, division: 1, district: 1 });

applyToJSON(addressSchema);

export const Address = model<IAddress>("Address", addressSchema);
