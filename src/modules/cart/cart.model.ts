import { Schema, model, Types } from "mongoose";

export interface ICartItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface ICart {
  _id: Types.ObjectId;
  userId: string;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const cartSchema = new Schema<ICart>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Cart = model<ICart>("Cart", cartSchema);

export function cartSubtotal(items: ICartItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;
}

export function toCartResponse(cart: ICart) {
  return {
    items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
    subtotal: cartSubtotal(cart.items),
  };
}
