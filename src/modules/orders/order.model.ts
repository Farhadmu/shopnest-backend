import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned"
  | "refunded";

export interface IOrderItem {
  productId: string;
  storeId: string;
  sellerId: string;
  title: string;
  quantity: number;
  price: number;
  image?: string;
  variantName?: string;
  variantSku?: string;
  variantColor?: string;
}

export interface IOrder {
  _id: Types.ObjectId;
  userId: string;
  items: IOrderItem[];
  subtotal: number;
  discount: number;
  division: string;
  deliveryFee: number;
  couponCode?: string;
  totalAmount: number;
  shippingAddress: string;
  paymentMethod: string;
  paymentStatus: "unpaid" | "paid" | "refunded";
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: Date }[];
  deliveryManId?: string;
  assignedAt?: Date;
  pickedUpAt?: Date;
  inTransitAt?: Date;
  outForDeliveryAt?: Date;
  deliveredAt?: Date;
  deliveryOtp?: string;
  deliveryProofImage?: string;
  deliveryFailedReason?: string;
  deliveryFailedAt?: Date;
  cancellationReason?: string;
  cancelledAt?: Date;
  cancelledBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: String, required: true },
    storeId: { type: String, required: true },
    sellerId: { type: String, required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    image: { type: String },
    variantName: { type: String },
    variantSku: { type: String },
    variantColor: { type: String },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    userId: { type: String, required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    division: { type: String, required: true },
    deliveryFee: { type: Number, required: true, min: 0 },
    couponCode: { type: String },
    totalAmount: { type: Number, required: true },
    shippingAddress: { type: String, required: true },
    paymentMethod: { type: String, required: true },
    paymentStatus: { type: String, enum: ["unpaid", "paid", "refunded"], default: "unpaid" },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
        "refunded",
      ],
      default: "pending",
      index: true,
    },
    statusHistory: {
      type: [{ status: String, at: Date }],
      default: [],
    },
    deliveryManId: { type: String, index: true },
    assignedAt: { type: Date },
    pickedUpAt: { type: Date },
    inTransitAt: { type: Date },
    outForDeliveryAt: { type: Date },
    deliveredAt: { type: Date },
    deliveryOtp: { type: String },
    deliveryProofImage: { type: String },
    deliveryFailedReason: { type: String },
    deliveryFailedAt: { type: Date },
    cancellationReason: { type: String },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
  },
  { timestamps: true }
);

applyToJSON(orderSchema);

export const Order = model<IOrder>("Order", orderSchema);
