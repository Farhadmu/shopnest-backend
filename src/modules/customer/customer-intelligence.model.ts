import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

// 1. Shopping Event & Journey
export interface IShoppingEvent {
  eventType: "search" | "view" | "category_browse" | "cart_add" | "wishlist_add" | "purchase" | "budget_plan";
  productId?: string;
  productTitle?: string;
  category?: string;
  price?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IShoppingJourney {
  _id: Types.ObjectId;
  userId: string;
  category: string;
  currentStage: "discovery" | "evaluation" | "intent" | "ready_to_buy" | "completed";
  events: IShoppingEvent[];
  recommendedNextCategory?: string;
  recommendedProducts?: string[];
  journeyProgress: number; // 0 - 100
  createdAt: Date;
  updatedAt: Date;
}

const shoppingEventSchema = new Schema<IShoppingEvent>(
  {
    eventType: {
      type: String,
      enum: ["search", "view", "category_browse", "cart_add", "wishlist_add", "purchase", "budget_plan"],
      required: true,
    },
    productId: { type: String },
    productTitle: { type: String },
    category: { type: String },
    price: { type: Number },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const shoppingJourneySchema = new Schema<IShoppingJourney>(
  {
    userId: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    currentStage: {
      type: String,
      enum: ["discovery", "evaluation", "intent", "ready_to_buy", "completed"],
      default: "discovery",
    },
    events: { type: [shoppingEventSchema], default: [] },
    recommendedNextCategory: { type: String },
    recommendedProducts: { type: [String], default: [] },
    journeyProgress: { type: Number, default: 20, min: 0, max: 100 },
  },
  { timestamps: true }
);

applyToJSON(shoppingJourneySchema);
export const ShoppingJourney = model<IShoppingJourney>("ShoppingJourney", shoppingJourneySchema);

// 2. Personal Shopping Goal
export interface IShoppingGoalItem {
  title: string;
  productId?: string;
  estimatedPrice: number;
  isCompleted: boolean;
  completedAt?: Date;
}

export interface IShoppingGoal {
  _id: Types.ObjectId;
  userId: string;
  title: string;
  category: string;
  targetBudget: number;
  targetDate?: Date;
  items: IShoppingGoalItem[];
  progressPercentage: number;
  status: "in_progress" | "achieved" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const shoppingGoalItemSchema = new Schema<IShoppingGoalItem>(
  {
    title: { type: String, required: true },
    productId: { type: String },
    estimatedPrice: { type: Number, required: true, min: 0 },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { _id: false }
);

const shoppingGoalSchema = new Schema<IShoppingGoal>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    targetBudget: { type: Number, required: true, min: 0 },
    targetDate: { type: Date },
    items: { type: [shoppingGoalItemSchema], default: [] },
    progressPercentage: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["in_progress", "achieved", "archived"],
      default: "in_progress",
      index: true,
    },
  },
  { timestamps: true }
);

applyToJSON(shoppingGoalSchema);
export const ShoppingGoal = model<IShoppingGoal>("ShoppingGoal", shoppingGoalSchema);

// 3. Product Life-Cycle Tracker
export interface IMaintenanceReminder {
  title: string;
  dueDate: Date;
  status: "pending" | "completed" | "overdue";
  notes?: string;
}

export interface IProductLifecycle {
  _id: Types.ObjectId;
  userId: string;
  orderId: string;
  productId: string;
  productTitle: string;
  category: string;
  purchaseDate: Date;
  estimatedLifespanMonths: number;
  usagePercentage: number; // 0 - 100
  warrantyExpiryDate: Date;
  maintenanceReminders: IMaintenanceReminder[];
  status: "active" | "replacement_recommended" | "retired";
  createdAt: Date;
  updatedAt: Date;
}

const maintenanceReminderSchema = new Schema<IMaintenanceReminder>(
  {
    title: { type: String, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "completed", "overdue"], default: "pending" },
    notes: { type: String },
  },
  { _id: false }
);

const productLifecycleSchema = new Schema<IProductLifecycle>(
  {
    userId: { type: String, required: true, index: true },
    orderId: { type: String, required: true },
    productId: { type: String, required: true },
    productTitle: { type: String, required: true },
    category: { type: String, required: true },
    purchaseDate: { type: Date, default: Date.now },
    estimatedLifespanMonths: { type: Number, default: 36 },
    usagePercentage: { type: Number, default: 10, min: 0, max: 100 },
    warrantyExpiryDate: { type: Date, required: true },
    maintenanceReminders: { type: [maintenanceReminderSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "replacement_recommended", "retired"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

applyToJSON(productLifecycleSchema);
export const ProductLifecycle = model<IProductLifecycle>("ProductLifecycle", productLifecycleSchema);

// 4. Product Price History
export interface IPriceHistoryPoint {
  price: number;
  recordedAt: Date;
}

export interface IPriceHistory {
  _id: Types.ObjectId;
  productId: string;
  history: IPriceHistoryPoint[];
  lowestPrice: number;
  highestPrice: number;
  averagePrice: number;
  currentPrice: number;
  trend: "dropping" | "rising" | "stable";
  insight: string;
  createdAt: Date;
  updatedAt: Date;
}

const priceHistorySchema = new Schema<IPriceHistory>(
  {
    productId: { type: String, required: true, unique: true, index: true },
    history: {
      type: [
        {
          price: { type: Number, required: true },
          recordedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    lowestPrice: { type: Number, default: 0 },
    highestPrice: { type: Number, default: 0 },
    averagePrice: { type: Number, default: 0 },
    currentPrice: { type: Number, default: 0 },
    trend: { type: String, enum: ["dropping", "rising", "stable"], default: "stable" },
    insight: { type: String, default: "Price is stable." },
  },
  { timestamps: true }
);

applyToJSON(priceHistorySchema);
export const PriceHistory = model<IPriceHistory>("PriceHistory", priceHistorySchema);

// 5. Product Bundle
export interface IProductBundleItem {
  productId: string;
  title: string;
  price: number;
  role: "main" | "accessory" | "complementary";
}

export interface IProductBundle {
  _id: Types.ObjectId;
  bundleName: string;
  mainProductId: string;
  category: string;
  items: IProductBundleItem[];
  originalTotal: number;
  bundlePrice: number;
  savingsPercentage: number;
  compatibilityNote: string;
  createdAt: Date;
  updatedAt: Date;
}

const productBundleSchema = new Schema<IProductBundle>(
  {
    bundleName: { type: String, required: true },
    mainProductId: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    items: [
      {
        productId: { type: String, required: true },
        title: { type: String, required: true },
        price: { type: Number, required: true },
        role: { type: String, enum: ["main", "accessory", "complementary"], default: "complementary" },
      },
    ],
    originalTotal: { type: Number, required: true },
    bundlePrice: { type: Number, required: true },
    savingsPercentage: { type: Number, default: 10 },
    compatibilityNote: { type: String, default: "100% verified complementary components." },
  },
  { timestamps: true }
);

applyToJSON(productBundleSchema);
export const ProductBundle = model<IProductBundle>("ProductBundle", productBundleSchema);
