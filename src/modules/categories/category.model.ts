import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface ICategory {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  parent?: Types.ObjectId | null;
  image?: string;

  /** Category Allocation & Lock System: set once an admin approves a seller's
   *  "specific-category" homepage coupon request for this category. */
  is_locked: boolean;
  assigned_seller_id?: Types.ObjectId | null;
  lockedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    parent: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    image: { type: String },

    is_locked: { type: Boolean, default: false, index: true },
    assigned_seller_id: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lockedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

applyToJSON(categorySchema);

export const Category = model<ICategory>("Category", categorySchema);
