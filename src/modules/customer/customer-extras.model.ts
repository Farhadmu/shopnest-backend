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

// 4. Saved Customer Addresses
export interface IAddress {
  _id: Types.ObjectId;
  userId: string;
  title: string;
  fullName: string;
  phone: string;
  division: string;
  district: string;
  upazila: string;
  city: string;
  streetAddress: string;
  postalCode: string;
  addressType: "home" | "office" | "university" | "other";
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, default: "Home" },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    division: { type: String, required: true, default: "Dhaka" },
    district: { type: String, required: true, default: "Dhaka" },
    upazila: { type: String, default: "" },
    city: { type: String, default: "" },
    streetAddress: { type: String, required: true },
    postalCode: { type: String, default: "" },
    addressType: { type: String, enum: ["home", "office", "university", "other"], default: "home" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

applyToJSON(addressSchema);
export const Address = model<IAddress>("Address", addressSchema);

// 5. Customer Support Tickets
export interface ISupportTicket {
  _id: Types.ObjectId;
  userId: string;
  orderId?: string;
  subject: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open", index: true },
  },
  { timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });
applyToJSON(supportTicketSchema);
export const SupportTicket = model<ISupportTicket>("SupportTicket", supportTicketSchema);
