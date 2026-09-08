import { Schema, model, Types } from "mongoose";

export interface IWishlistItem {
  productId: string;
  addedAt: Date;
}

export interface IWishlist {
  _id: Types.ObjectId;
  userId: string;
  items: IWishlistItem[];
}

const wishlistItemSchema = new Schema<IWishlistItem>(
  {
    productId: { type: String, required: true },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const wishlistSchema = new Schema<IWishlist>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [wishlistItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Wishlist = model<IWishlist>("Wishlist", wishlistSchema);
