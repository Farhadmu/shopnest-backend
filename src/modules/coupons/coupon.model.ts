import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface ICoupon {
  _id: Types.ObjectId;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minPurchase: number;
  maxDiscount?: number;
  category?: string;
  productId?: string;
  createdBy: string;
  startsAt?: Date;
  expiresAt?: Date;
  usageLimit?: number;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    minPurchase: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    category: { type: String },
    productId: { type: String },
    createdBy: { type: String, required: true },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    usageLimit: { type: Number },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyToJSON(couponSchema);

export const Coupon = model<ICoupon>("Coupon", couponSchema);

/** Computes the discount amount for a subtotal; throws-free, returns 0 if invalid/inapplicable. */
export function computeDiscount(coupon: ICoupon, subtotal: number): number {
  if (!coupon.isActive) return 0;
  if (coupon.startsAt && coupon.startsAt > new Date()) return 0;
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return 0;
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return 0;
  if (subtotal < coupon.minPurchase) return 0;

  let discount = coupon.type === "percentage" ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return Math.min(discount, subtotal);
}
