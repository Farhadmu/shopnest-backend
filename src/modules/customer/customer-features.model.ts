import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// ============================================================
// 1. Personal Shopping Profile (Feature 30)
// ============================================================
export interface IUserPreferences {
  _id: Types.ObjectId;
  userId: string;
  preferredCategories: string[];
  typicalBudgetMin: number;
  typicalBudgetMax: number;
  preferredSellers: string[];
  preferredDelivery: "standard" | "express" | "any";
  favoriteBrands: string[];
  shoppingInterests: string[];
  allowPersonalization: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userPreferencesSchema = new Schema<IUserPreferences>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    preferredCategories: { type: [String], default: [] },
    typicalBudgetMin: { type: Number, default: 0 },
    typicalBudgetMax: { type: Number, default: 50000 },
    preferredSellers: { type: [String], default: [] },
    preferredDelivery: { type: String, enum: ["standard", "express", "any"], default: "any" },
    favoriteBrands: { type: [String], default: [] },
    shoppingInterests: { type: [String], default: [] },
    allowPersonalization: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyToJSON(userPreferencesSchema);
export const UserPreferences = model<IUserPreferences>("UserPreferences", userPreferencesSchema);

// ============================================================
// 2. Customer Loyalty & Rewards (Feature 26)
// ============================================================
export type LoyaltyLevel = "bronze" | "silver" | "gold" | "platinum";

export interface ILoyaltyPoints {
  _id: Types.ObjectId;
  userId: string;
  totalPoints: number;
  availablePoints: number;
  lifetimePoints: number;
  level: LoyaltyLevel;
  joinedAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const loyaltyPointsSchema = new Schema<ILoyaltyPoints>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    totalPoints: { type: Number, default: 0 },
    availablePoints: { type: Number, default: 0 },
    lifetimePoints: { type: Number, default: 0 },
    level: { type: String, enum: ["bronze", "silver", "gold", "platinum"], default: "bronze" },
    joinedAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applyToJSON(loyaltyPointsSchema);
export const LoyaltyPoints = model<ILoyaltyPoints>("LoyaltyPoints", loyaltyPointsSchema);

export interface ILoyaltyTransaction {
  _id: Types.ObjectId;
  userId: string;
  type: "earned" | "redeemed" | "expired" | "bonus";
  points: number;
  description: string;
  orderId?: string;
  balanceAfter: number;
  createdAt: Date;
}

const loyaltyTransactionSchema = new Schema<ILoyaltyTransaction>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["earned", "redeemed", "expired", "bonus"], required: true },
    points: { type: Number, required: true },
    description: { type: String, required: true },
    orderId: { type: String },
    balanceAfter: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(loyaltyTransactionSchema);
export const LoyaltyTransaction = model<ILoyaltyTransaction>("LoyaltyTransaction", loyaltyTransactionSchema);

// ============================================================
// 3. Smart Payment Center (Feature 12)
// ============================================================
export interface IPaymentRecord {
  _id: Types.ObjectId;
  userId: string;
  orderId: string;
  amount: number;
  method: "cash_on_delivery" | "card" | "mobile_banking" | "bank_transfer";
  status: "successful" | "failed" | "pending" | "refunded";
  transactionId?: string;
  description: string;
  createdAt: Date;
}

const paymentRecordSchema = new Schema<IPaymentRecord>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ["cash_on_delivery", "card", "mobile_banking", "bank_transfer"],
      required: true,
    },
    status: {
      type: String,
      enum: ["successful", "failed", "pending", "refunded"],
      required: true,
      index: true,
    },
    transactionId: { type: String },
    description: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyToJSON(paymentRecordSchema);
export const PaymentRecord = model<IPaymentRecord>("PaymentRecord", paymentRecordSchema);

// ============================================================
// 4. Smart Voucher Wallet (Feature 13)
// ============================================================
export interface IUserCoupon {
  _id: Types.ObjectId;
  userId: string;
  couponCode: string;
  title: string;
  description: string;
  type: "percentage" | "fixed" | "free_delivery";
  value: number;
  minPurchase: number;
  category?: string;
  sellerId?: string;
  source: "platform" | "seller" | "personalized" | "loyalty";
  status: "available" | "used" | "expired";
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

const userCouponSchema = new Schema<IUserCoupon>(
  {
    userId: { type: String, required: true, index: true },
    couponCode: { type: String, required: true, uppercase: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    type: { type: String, enum: ["percentage", "fixed", "free_delivery"], required: true },
    value: { type: Number, required: true, min: 0 },
    minPurchase: { type: Number, default: 0 },
    category: { type: String },
    sellerId: { type: String },
    source: { type: String, enum: ["platform", "seller", "personalized", "loyalty"], default: "platform" },
    status: { type: String, enum: ["available", "used", "expired"], default: "available", index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

userCouponSchema.index({ userId: 1, status: 1 });
applyToJSON(userCouponSchema);
export const UserCoupon = model<IUserCoupon>("UserCoupon", userCouponSchema);

// ============================================================
// 5. Customer-Seller Communication (Feature 24)
// ============================================================
export interface ICustomerSellerMessage {
  _id: Types.ObjectId;
  conversationId: string;
  senderId: string;
  senderRole: "customer" | "seller";
  receiverId: string;
  receiverRole: "customer" | "seller";
  orderId?: string;
  productId?: string;
  subject: string;
  message: string;
  isRead: boolean;
  isReported: boolean;
  reportReason?: string;
  createdAt: Date;
}

const customerSellerMessageSchema = new Schema<ICustomerSellerMessage>(
  {
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderRole: { type: String, enum: ["customer", "seller"], required: true },
    receiverId: { type: String, required: true, index: true },
    receiverRole: { type: String, enum: ["customer", "seller"], required: true },
    orderId: { type: String, index: true },
    productId: { type: String },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    isRead: { type: Boolean, default: false },
    isReported: { type: Boolean, default: false },
    reportReason: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

customerSellerMessageSchema.index({ conversationId: 1, createdAt: -1 });
applyToJSON(customerSellerMessageSchema);
export const CustomerSellerMessage = model<ICustomerSellerMessage>("CustomerSellerMessage", customerSellerMessageSchema);

// ============================================================
// 6. Search History (Feature 1 - Advanced AI Search)
// ============================================================
export interface ISearchHistory {
  _id: Types.ObjectId;
  userId: string;
  query: string;
  filters?: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    brand?: string;
    rating?: number;
    seller?: string;
    availability?: string;
  };
  resultCount: number;
  createdAt: Date;
}

const searchHistorySchema = new Schema<ISearchHistory>(
  {
    userId: { type: String, required: true, index: true },
    query: { type: String, required: true, trim: true },
    filters: {
      category: { type: String },
      minPrice: { type: Number },
      maxPrice: { type: Number },
      brand: { type: String },
      rating: { type: Number },
      seller: { type: String },
      availability: { type: String },
    },
    resultCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

searchHistorySchema.index({ userId: 1, createdAt: -1 });
applyToJSON(searchHistorySchema);
export const SearchHistory = model<ISearchHistory>("SearchHistory", searchHistorySchema);

// ============================================================
// 7. Buy Again Tracking (Feature 18)
// ============================================================
export interface IBuyAgainItem {
  _id: Types.ObjectId;
  userId: string;
  productId: string;
  productTitle: string;
  category: string;
  lastPurchasedAt: Date;
  lastOrderId: string;
  purchaseCount: number;
  lastPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

const buyAgainItemSchema = new Schema<IBuyAgainItem>(
  {
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    category: { type: String, required: true },
    lastPurchasedAt: { type: Date, default: Date.now },
    lastOrderId: { type: String, required: true },
    purchaseCount: { type: Number, default: 1 },
    lastPrice: { type: Number, required: true },
  },
  { timestamps: true }
);

buyAgainItemSchema.index({ userId: 1, productId: 1 }, { unique: true });
buyAgainItemSchema.index({ userId: 1, lastPurchasedAt: -1 });
applyToJSON(buyAgainItemSchema);
export const BuyAgainItem = model<IBuyAgainItem>("BuyAgainItem", buyAgainItemSchema);

// ============================================================
// 8. Digital Purchase Vault (Feature 22)
// ============================================================
export interface IPurchaseDocument {
  _id: Types.ObjectId;
  userId: string;
  orderId: string;
  type: "invoice" | "receipt" | "warranty" | "return_label";
  title: string;
  documentNumber: string;
  issueDate: Date;
  sellerId: string;
  sellerName: string;
  items: Array<{ title: string; quantity: number; price: number }>;
  totalAmount: number;
  warrantyInfo?: {
    duration: string;
    expiresAt: Date;
    terms?: string;
  };
  createdAt: Date;
}

const purchaseDocumentSchema = new Schema<IPurchaseDocument>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    type: { type: String, enum: ["invoice", "receipt", "warranty", "return_label"], required: true },
    title: { type: String, required: true },
    documentNumber: { type: String, required: true, unique: true },
    issueDate: { type: Date, default: Date.now },
    sellerId: { type: String, required: true },
    sellerName: { type: String, required: true },
    items: [
      {
        title: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
      },
    ],
    totalAmount: { type: Number, required: true },
    warrantyInfo: {
      duration: { type: String },
      expiresAt: { type: Date },
      terms: { type: String },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

purchaseDocumentSchema.index({ userId: 1, type: 1, createdAt: -1 });
applyToJSON(purchaseDocumentSchema);
export const PurchaseDocument = model<IPurchaseDocument>("PurchaseDocument", purchaseDocumentSchema);

// ============================================================
// 9. Smart Return Center (Feature 11) - Return Request
// ============================================================
export interface IReturnRequest {
  _id: Types.ObjectId;
  userId: string;
  orderId: string;
  productId: string;
  productTitle: string;
  sellerId: string;
  type: "return" | "refund" | "replacement";
  reason: string;
  status: "requested" | "approved" | "pickup" | "received" | "refunded" | "rejected";
  statusHistory: Array<{ status: string; at: Date; note?: string }>;
  refundAmount?: number;
  refundMethod?: string;
  evidenceUrls: string[];
  createdAt: Date;
  updatedAt: Date;
}

const returnRequestSchema = new Schema<IReturnRequest>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    productTitle: { type: String, required: true },
    sellerId: { type: String, required: true },
    type: { type: String, enum: ["return", "refund", "replacement"], required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["requested", "approved", "pickup", "received", "refunded", "rejected"],
      default: "requested",
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        at: { type: Date, default: Date.now },
        note: { type: String },
      },
    ],
    refundAmount: { type: Number },
    refundMethod: { type: String },
    evidenceUrls: { type: [String], default: [] },
  },
  { timestamps: true }
);

returnRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });
applyToJSON(returnRequestSchema);
export const ReturnRequest = model<IReturnRequest>("ReturnRequest", returnRequestSchema);

// ============================================================
// 10. Product Quality Score Cache (Feature 7)
// ============================================================
export interface IProductQualityScore {
  _id: Types.ObjectId;
  productId: string;
  overallScore: number;
  ratingScore: number;
  valueScore: number;
  sellerScore: number;
  deliveryScore: number;
  reviewCount: number;
  sentimentPositive: number;
  sentimentNegative: number;
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const productQualityScoreSchema = new Schema<IProductQualityScore>(
  {
    productId: { type: String, required: true, unique: true, index: true },
    overallScore: { type: Number, required: true, min: 0, max: 100 },
    ratingScore: { type: Number, required: true, min: 0, max: 100 },
    valueScore: { type: Number, required: true, min: 0, max: 100 },
    sellerScore: { type: Number, required: true, min: 0, max: 100 },
    deliveryScore: { type: Number, required: true, min: 0, max: 100 },
    reviewCount: { type: Number, default: 0 },
    sentimentPositive: { type: Number, default: 0 },
    sentimentNegative: { type: Number, default: 0 },
    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applyToJSON(productQualityScoreSchema);
export const ProductQualityScore = model<IProductQualityScore>("ProductQualityScore", productQualityScoreSchema);
