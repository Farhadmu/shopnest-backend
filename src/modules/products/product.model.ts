import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type ProductStatus = "pending" | "approved" | "rejected";

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
  status: ProductStatus;
  ratingAvg: number;
  ratingCount: number;
  sold: number;
  views: number;
  isDeleted: boolean;
  sentiment?: { positive: number; neutral: number; negative: number };
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true, trim: true, index: "text" },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },
    category: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    stock: { type: Number, required: true, min: 0, default: 0 },
    images: { type: [String], default: [] },
    tags: { type: [String], default: [], index: true },
    specifications: { type: Map, of: String, default: {} },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
    sentiment: {
      positive: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

productSchema.index({ title: "text", description: "text", tags: "text" });

applyToJSON(productSchema);

export const Product = model<IProduct>("Product", productSchema);
