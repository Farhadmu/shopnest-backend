import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface ISpendingBudget {
  _id: Types.ObjectId;
  userId: string;
  monthlyBudget: number;
  updatedAt: Date;
}

const spendingBudgetSchema = new Schema<ISpendingBudget>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    monthlyBudget: { type: Number, required: true, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

applyToJSON(spendingBudgetSchema);

export const SpendingBudget = model<ISpendingBudget>("SpendingBudget", spendingBudgetSchema);
