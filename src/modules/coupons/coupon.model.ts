import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type CouponScope = "all-products" | "specific-category" | "specific-products";
export type CouponPlacement = "store" | "homepage" | "private";
export type CouponApprovalStatus = "approved" | "pending" | "rejected" | "reported";
export type CouponHomepageStatus = "running" | "queued" | "expired";

export type CouponType = "percentage" | "fixed" | "free-shipping";

export interface ICoupon {
  _id: Types.ObjectId;
  code: string;
  type: CouponType;
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
    type: { type: String, enum: ["percentage", "fixed", "free-shipping"], required: true },
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

export interface CartLineItem {
  productId: string;
  category: string;
  sellerId: string;
  price: number;
  quantity: number;
}

/**
 * Shared eligibility checks used by both subtotal discounting and free-shipping
 * waivers: active, approved, within the start/expiry window, under the usage
 * limit, and the subtotal meets minPurchase.
 */
export function isCouponEligible(coupon: ICoupon, items: CartLineItem[]): boolean {
  if (!coupon.isActive) return false;
  if (coupon.approvalStatus !== "approved") return false;
  if (coupon.startsAt && coupon.startsAt > new Date()) return false;
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return false;
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return false;
  if (computeApplicableSubtotal(coupon, items) <= 0) return false;
  if (computeApplicableSubtotal(coupon, items) < coupon.minPurchase) return false;
  return true;
}

/**
 * Computes the discount amount for a set of cart line items; throws-free, returns 0 if invalid/inapplicable.
 * "free-shipping" coupons discount nothing on the subtotal — they waive the delivery
 * fee instead (see isFreeShippingCouponApplicable / the checkout/order module).
 */
export function computeDiscount(coupon: ICoupon, items: CartLineItem[]): number {
  if (!isCouponEligible(coupon, items)) return 0;
  if (coupon.type === "free-shipping") return 0;

  const applicableSubtotal = computeApplicableSubtotal(coupon, items);
  let discount = coupon.type === "percentage" ? (applicableSubtotal * coupon.value) / 100 : coupon.value;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return Math.min(discount, applicableSubtotal);
}

/** Whether a coupon is a valid, currently-usable free-shipping coupon for this set of line items. */
export function isFreeShippingCouponApplicable(coupon: ICoupon, items: CartLineItem[]): boolean {
  return coupon.type === "free-shipping" && isCouponEligible(coupon, items);
}

export function computeApplicableSubtotal(coupon: ICoupon, items: CartLineItem[]): number {
  let applicableSubtotal = 0;

  const isAdminCoupon = coupon.createdByRole === "admin";

  switch (coupon.scope) {
    case "all-products": {
      const filteredItems = isAdminCoupon
        ? items
        : items.filter((item) => item.sellerId === coupon.createdBy);
      applicableSubtotal = filteredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      break;
    }
    case "specific-category": {
      const allowedCategories = new Set([
        ...(coupon.categories ?? []),
        ...(coupon.category ? [coupon.category] : []),
      ]);
      const filteredItems = isAdminCoupon
        ? items.filter((item) => allowedCategories.has(item.category))
        : items.filter((item) => item.sellerId === coupon.createdBy && allowedCategories.has(item.category));
      applicableSubtotal = filteredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      break;
    }
    case "specific-products": {
      const allowedProductIds = new Set(coupon.productIds);
      const filteredItems = isAdminCoupon
        ? items.filter((item) => allowedProductIds.has(item.productId))
        : items.filter((item) => allowedProductIds.has(item.productId) && item.sellerId === coupon.createdBy);
      applicableSubtotal = filteredItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      break;
    }
  }

  return Math.round(applicableSubtotal * 100) / 100;
}
