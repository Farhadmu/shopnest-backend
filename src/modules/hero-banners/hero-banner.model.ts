import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IHeroBanner {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId | null;
  imageUrl: string;
  placement: "hero" | "side" | "bottom";
  eyebrow?: string | null;
  title?: string | null;
  highlight?: string | null;
  subtitle?: string | null;
  description?: string | null;
  price?: string | null;
  buttonText?: string | null;
  targetUrl?: string | null;
  bgClassName?: string | null;
  textTheme: "light" | "dark";
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const heroBannerSchema = new Schema<IHeroBanner>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", index: true, default: null },
    imageUrl: { type: String, required: true },
    placement: { type: String, enum: ["hero", "side", "bottom"], default: "hero", index: true },
    eyebrow: { type: String, default: null },
    title: { type: String, default: null, index: true },
    highlight: { type: String, default: null },
    subtitle: { type: String, default: null },
    description: { type: String, default: null },
    price: { type: String, default: null },
    buttonText: { type: String, default: null },
    targetUrl: { type: String, default: null },
    bgClassName: { type: String, default: null },
    textTheme: { type: String, enum: ["light", "dark"], default: "light" },
    isActive: { type: Boolean, default: true, index: true },
    displayOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

heroBannerSchema.index({ categoryId: 1, isActive: 1, displayOrder: 1 });
heroBannerSchema.index({ categoryId: 1, displayOrder: 1 });
heroBannerSchema.index({ categoryId: 1, placement: 1, isActive: 1, displayOrder: 1 });

applyToJSON(heroBannerSchema);

export const HeroBanner = model<IHeroBanner>("HeroBanner", heroBannerSchema);
