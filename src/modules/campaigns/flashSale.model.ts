import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IFlashSale {
  _id: Types.ObjectId;
  title: string;
  productIds: string[];
  discountType: "percentage" | "fixed";
  discountValue: number;
  productLimit?: number;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const flashSaleSchema = new Schema<IFlashSale>(
  {
    title: { type: String, required: true, trim: true },
    productIds: { type: [String], required: true, validate: (v: string[]) => v.length > 0 },
    discountType: { type: String, enum: ["percentage", "fixed"], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    productLimit: { type: Number, min: 1 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    createdBy: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

flashSaleSchema.index({ startsAt: 1, endsAt: 1 });

applyToJSON(flashSaleSchema);

export const FlashSale = model<IFlashSale>("FlashSale", flashSaleSchema);

/** True if the sale window is currently open and the sale is active. */
export function isFlashSaleLive(sale: IFlashSale, now: Date = new Date()): boolean {
  return sale.isActive && sale.startsAt <= now && sale.endsAt >= now;
}

/** Computes the sale price for a given base price under a flash sale's discount rule. */
export function computeFlashSalePrice(sale: IFlashSale, basePrice: number): number {
  const discount =
    sale.discountType === "percentage" ? (basePrice * sale.discountValue) / 100 : sale.discountValue;
  return Math.max(0, Math.round((basePrice - discount) * 100) / 100);
}
