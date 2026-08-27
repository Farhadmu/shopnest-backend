import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// 1. Saved Searches
export interface ISavedSearch {
  _id: Types.ObjectId;
  userId: string;
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  resultCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const savedSearchSchema = new Schema<ISavedSearch>(
  {
    userId: { type: String, required: true, index: true },
    query: { type: String, required: true, trim: true },
    category: { type: String },
    minPrice: { type: Number },
    maxPrice: { type: Number },
    sort: { type: String },
    resultCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

applyToJSON(savedSearchSchema);
export const SavedSearch = model<ISavedSearch>("SavedSearch", savedSearchSchema);

// 2. Personalized Offers
export interface IPersonalizedOffer {
  _id: Types.ObjectId;
  userId: string;
  code: string;
  title: string;
  description: string;
  discountPercent: number;
  category: string;
  minSpend: number;
  expiresAt: Date;
  isClaimed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const personalizedOfferSchema = new Schema<IPersonalizedOffer>(
  {
    userId: { type: String, required: true, index: true },
    code: { type: String, required: true, uppercase: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    discountPercent: { type: Number, required: true, min: 1, max: 90 },
    category: { type: String, required: true },
    minSpend: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    isClaimed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

applyToJSON(personalizedOfferSchema);
export const PersonalizedOffer = model<IPersonalizedOffer>("PersonalizedOffer", personalizedOfferSchema);

// 3. Customer Activity Timeline
export interface ICustomerActivity {
  _id: Types.ObjectId;
  userId: string;
  activityType: "view" | "search" | "wishlist_add" | "cart_add" | "order" | "review" | "security";
  title: string;
  details?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const customerActivitySchema = new Schema<ICustomerActivity>(
  {
    userId: { type: String, required: true, index: true },
    activityType: {
      type: String,
      enum: ["view", "search", "wishlist_add", "cart_add", "order", "review", "security"],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    details: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(customerActivitySchema);
export const CustomerActivity = model<ICustomerActivity>("CustomerActivity", customerActivitySchema);
