import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type CouponScope = "all-products" | "specific-category" | "specific-products";
export type CouponPlacement = "store" | "homepage" | "private";
export type CouponApprovalStatus = "approved" | "pending" | "rejected" | "reported";
export type CouponHomepageStatus = "running" | "queued" | "expired";

export interface ICoupon {
  _id: Types.ObjectId;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minPurchase: number;
  maxDiscount?: number;

  /** What the discount applies to. */
  scope: CouponScope;
  category?: string;
  categories?: string[];
  productIds: string[];

  /**
   * Where the coupon is allowed to surface:
   *  - "store"    -> shown on the seller's own store page, live instantly
   *  - "homepage" -> requested for the marketplace homepage, needs admin approval
   *  - "private"  -> shown nowhere; only usable if the seller shares the code directly
   */
  placement: CouponPlacement;
  approvalStatus: CouponApprovalStatus;
  rejectionNote?: string;

  createdBy: string;
  createdByRole: "seller" | "admin";

  /** Used for "store"/"private" placement. */
  startsAt?: Date;
  expiresAt?: Date;

  /** Used for "homepage" placement instead of a fixed end date. */
  promoStartDate?: Date;
  durationDays?: number;
  approvedAt?: Date;

  /** Homepage Coupon Queue Engine: "running" (one of the 3 live slots),
   *  "queued" (approved, waiting for a running slot to free up), or
   *  "expired" (finished; kept for fallback visibility until replaced). */
  homepageStatus?: CouponHomepageStatus;

  /** Queue position (1-based) for queued coupons. */
  queuePosition?: number;

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

    scope: {
      type: String,
      enum: ["all-products", "specific-category", "specific-products"],
      default: "all-products",
    },
    category: { type: String },
    categories: { type: [String], default: [] },
    productIds: { type: [String], default: [] },

    placement: { type: String, enum: ["store", "homepage", "private"], default: "store", index: true },
    approvalStatus: { type: String, enum: ["approved", "pending", "rejected", "reported"], default: "approved", index: true },
    rejectionNote: { type: String },

    createdBy: { type: String, required: true, index: true },
    createdByRole: { type: String, enum: ["seller", "admin"], default: "seller" },

    startsAt: { type: Date },
    expiresAt: { type: Date },

    promoStartDate: { type: Date },
    durationDays: { type: Number },
    approvedAt: { type: Date },

    homepageStatus: { type: String, enum: ["running", "queued", "expired"], index: true },

    queuePosition: { type: Number },

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
  if (coupon.approvalStatus !== "approved") return 0;
  if (coupon.startsAt && coupon.startsAt > new Date()) return 0;
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return 0;
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return 0;
  if (subtotal < coupon.minPurchase) return 0;

  let discount = coupon.type === "percentage" ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return Math.min(discount, subtotal);
}
