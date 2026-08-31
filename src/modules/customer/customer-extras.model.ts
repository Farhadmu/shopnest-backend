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
  area: string;
  unionWard: string;
  road: string;
  house: string;
  landmark: string;
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
    area: { type: String, default: "" },
    unionWard: { type: String, default: "" },
    road: { type: String, default: "" },
    house: { type: String, default: "" },
    landmark: { type: String, default: "" },
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

// 6. Price Drop Alert Subscription
export interface IPriceAlert {
  _id: Types.ObjectId;
  userId: string;
  productId: string;
  productTitle: string;
  targetPrice: number;
  currentPrice: number;
  isTriggered: boolean;
  notifiedAt?: Date;
  createdAt: Date;
}

const priceAlertSchema = new Schema<IPriceAlert>(
  {
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    targetPrice: { type: Number, required: true },
    currentPrice: { type: Number, required: true },
    isTriggered: { type: Boolean, default: false },
    notifiedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

priceAlertSchema.index({ userId: 1, productId: 1 }, { unique: true });
applyToJSON(priceAlertSchema);
export const PriceAlert = model<IPriceAlert>("PriceAlert", priceAlertSchema);

// 7. Back-in-Stock Alert Subscription
export interface IStockAlert {
  _id: Types.ObjectId;
  userId: string;
  userEmail?: string;
  productId: string;
  productTitle: string;
  isNotified: boolean;
  notifiedAt?: Date;
  createdAt: Date;
}

const stockAlertSchema = new Schema<IStockAlert>(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    isNotified: { type: Boolean, default: false },
    notifiedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockAlertSchema.index({ userId: 1, productId: 1 }, { unique: true });
applyToJSON(stockAlertSchema);
export const StockAlert = model<IStockAlert>("StockAlert", stockAlertSchema);

// 8. Product Review Q&A
export interface IProductAnswer {
  _id?: Types.ObjectId;
  authorId: string;
  authorName: string;
  authorRole: "seller" | "customer" | "ai_assistant";
  content: string;
  helpfulVotes: number;
  createdAt: Date;
}

export interface IProductQuestion {
  _id: Types.ObjectId;
  productId: string;
  userId: string;
  userName: string;
  question: string;
  answers: IProductAnswer[];
  isAnswered: boolean;
  createdAt: Date;
}

const productAnswerSchema = new Schema<IProductAnswer>(
  {
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, enum: ["seller", "customer", "ai_assistant"], default: "customer" },
    content: { type: String, required: true },
    helpfulVotes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

const productQuestionSchema = new Schema<IProductQuestion>(
  {
    productId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answers: { type: [productAnswerSchema], default: [] },
    isAnswered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

applyToJSON(productQuestionSchema);
export const ProductQuestion = model<IProductQuestion>("ProductQuestion", productQuestionSchema);

// 9. Product Problem Report (Admin Moderation)
export interface IProductReport {
  _id: Types.ObjectId;
  userId: string;
  productId: string;
  productTitle: string;
  sellerId?: string;
  category: "wrong_info" | "misleading_image" | "wrong_specs" | "suspicious_seller" | "damaged_product" | "other";
  description: string;
  evidenceUrls: string[];
  status: "pending" | "investigating" | "resolved" | "dismissed";
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const productReportSchema = new Schema<IProductReport>(
  {
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    sellerId: { type: String },
    category: {
      type: String,
      enum: ["wrong_info", "misleading_image", "wrong_specs", "suspicious_seller", "damaged_product", "other"],
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    evidenceUrls: { type: [String], default: [] },
    status: { type: String, enum: ["pending", "investigating", "resolved", "dismissed"], default: "pending" },
    adminNotes: { type: String },
  },
  { timestamps: true }
);

applyToJSON(productReportSchema);
export const ProductReport = model<IProductReport>("ProductReport", productReportSchema);

// 10. Delivery Experience Feedback
export interface IDeliveryFeedback {
  _id: Types.ObjectId;
  userId: string;
  orderId: string;
  courierName: string;
  speedRating: number; // 1-5
  packagingRating: number; // 1-5
  courierBehaviorRating: number; // 1-5
  overallRating: number; // 1-5
  feedbackText?: string;
  createdAt: Date;
}

const deliveryFeedbackSchema = new Schema<IDeliveryFeedback>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, unique: true, index: true },
    courierName: { type: String, default: "Standard Express" },
    speedRating: { type: Number, required: true, min: 1, max: 5 },
    packagingRating: { type: Number, required: true, min: 1, max: 5 },
    courierBehaviorRating: { type: Number, required: true, min: 1, max: 5 },
    overallRating: { type: Number, required: true, min: 1, max: 5 },
    feedbackText: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(deliveryFeedbackSchema);
export const DeliveryFeedback = model<IDeliveryFeedback>("DeliveryFeedback", deliveryFeedbackSchema);

// 11. Comparison History
export interface IComparisonHistory {
  _id: Types.ObjectId;
  userId: string;
  title: string;
  productIds: string[];
  category: string;
  createdAt: Date;
}

const comparisonHistorySchema = new Schema<IComparisonHistory>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, default: "Product Comparison" },
    productIds: { type: [String], required: true },
    category: { type: String, default: "General" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

comparisonHistorySchema.index({ userId: 1, createdAt: -1 });
applyToJSON(comparisonHistorySchema);
export const ComparisonHistory = model<IComparisonHistory>("ComparisonHistory", comparisonHistorySchema);

// 12. Smart Wishlist Custom Groups
export interface IWishlistGroup {
  _id: Types.ObjectId;
  userId: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  productIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const wishlistGroupSchema = new Schema<IWishlistGroup>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "❤️" },
    color: { type: String, default: "#6366f1" },
    productIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

wishlistGroupSchema.index({ userId: 1, name: 1 }, { unique: true });
applyToJSON(wishlistGroupSchema);
export const WishlistGroup = model<IWishlistGroup>("WishlistGroup", wishlistGroupSchema);

