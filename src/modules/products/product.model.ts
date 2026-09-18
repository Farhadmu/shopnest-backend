import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type ProductStatus = "pending" | "approved" | "rejected";

export interface IProductVariant {
  name: string;
  sku?: string;
  stock?: number;
  price?: number;
  color?: string;
}

export interface IProductHighlight {
  title: string;
  description?: string;
  icon?: string;
}

export interface IProduct {
  _id: Types.ObjectId;
  title: string;
  description: string;
  price: number;
  discountPrice?: number;
  category: string;
  storeId: string;
  sellerId: string;
  stock: number;
  images: string[];
  tags: string[];
  specifications: Map<string, string>;
  variants: IProductVariant[];
  highlights: IProductHighlight[];
  packageContents: string[];
  status: ProductStatus;
  ratingAvg: number;
  ratingCount: number;
  sold: number;
  views: number;
  isDeleted: boolean;
  storeSuspended: boolean;
  freeDelivery: boolean;
  aiPick: boolean;
  isFeatured: boolean;
  warrantyMonths?: number;
  warrantyProvider?: string;
  sentiment?: { positive: number; neutral: number; negative: number };
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<IProductVariant>(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    stock: { type: Number, min: 0, default: 0 },
    price: { type: Number, min: 0 },
    color: { type: String, trim: true },
  },
  { _id: false }
);

const highlightSchema = new Schema<IProductHighlight>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    icon: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true, trim: true, index: "text" },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0, index: true },
    discountPrice: { type: Number, min: 0 },
    category: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    stock: { type: Number, required: true, min: 0, default: 0 },
    storeSuspended: { type: Boolean, default: false, index: true },
    images: { type: [String], default: [] },
    tags: { type: [String], default: [], index: true },
    specifications: { type: Map, of: String, default: {} },
    variants: { type: [variantSchema], default: [] },
    highlights: { type: [highlightSchema], default: [] },
    packageContents: { type: [String], default: [] },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5, index: true },
    ratingCount: { type: Number, default: 0 },
    sold: { type: Number, default: 0, index: true },
    views: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
    freeDelivery: { type: Boolean, default: false, index: true },
    aiPick: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    warrantyMonths: { type: Number, min: 0 },
    warrantyProvider: { type: String },
    sentiment: {
      positive: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

productSchema.index({ title: "text", description: "text", tags: "text" });
productSchema.index({ createdAt: 1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, createdAt: -1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, isFeatured: 1, createdAt: -1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, category: 1, createdAt: -1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, price: 1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, ratingAvg: -1 });
productSchema.index({ isDeleted: 1, status: 1, storeSuspended: 1, sold: -1 });

productSchema.pre("save", function (next) {
  if (this.variants && Array.isArray(this.variants) && this.variants.length > 0) {
    this.stock = this.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  }
  next();
});

applyToJSON(productSchema);

export const Product = model<IProduct>("Product", productSchema);
