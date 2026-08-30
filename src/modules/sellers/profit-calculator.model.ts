import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IProfitCalculator {
  _id: Types.ObjectId;
  sellerId: string;
  productId: string;
  sellingPrice: number;
  productCost: number;
  deliveryCost: number;
  platformFee: number;
  discount: number;
  estimatedProfit: number;
  profitMargin: number;
  calculatedAt: Date;
}

const profitCalculatorSchema = new Schema<IProfitCalculator>(
  {
    sellerId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    sellingPrice: { type: Number, required: true, min: 0 },
    productCost: { type: Number, required: true, min: 0 },
    deliveryCost: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    estimatedProfit: { type: Number, required: true },
    profitMargin: { type: Number, required: true, min: 0, max: 100 },
    calculatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

profitCalculatorSchema.index({ sellerId: 1, productId: 1 }, { unique: true });

applyToJSON(profitCalculatorSchema);

export const ProfitCalculator = model<IProfitCalculator>("ProfitCalculator", profitCalculatorSchema);
