import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type StoreStatus = "pending" | "approved" | "rejected" | "suspended";

export interface IStore {
  _id: Types.ObjectId;
  ownerId: string;
  storeName: string;
  slug: string;
  description: string;
  logo?: string;
  banner?: string;
  businessInfo?: {
    ownerName?: string;
    contactPhone?: string;
    businessAddress?: string;
  };
  status: StoreStatus;
  trustScore: number;
  rating: number;
  ratingCount: number;
  followersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const storeSchema = new Schema<IStore>(
  {
    ownerId: { type: String, required: true, index: true, unique: true },
    storeName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, required: true },
    logo: { type: String },
    banner: { type: String },
    businessInfo: {
      ownerName: String,
      contactPhone: String,
      businessAddress: String,
    },
    status: { type: String, enum: ["pending", "approved", "rejected", "suspended"], default: "pending" },
    trustScore: { type: Number, default: 60, min: 0, max: 100 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

applyToJSON(storeSchema);

export const Store = model<IStore>("Store", storeSchema);
