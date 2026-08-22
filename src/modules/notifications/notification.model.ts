import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type NotificationType =
  | "order_confirmation"
  | "order_shipped"
  | "order_delivered"
  | "price_drop"
  | "coupon"
  | "low_stock"
  | "seller_approval"
  | "new_review"
  | "flash_sale";

export interface INotification {
  _id: Types.ObjectId;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  relatedId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "order_confirmation",
        "order_shipped",
        "order_delivered",
        "price_drop",
        "coupon",
        "low_stock",
        "seller_approval",
        "new_review",
        "flash_sale",
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false, index: true },
    link: { type: String },
    relatedId: { type: String },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

applyToJSON(notificationSchema);

export const Notification = model<INotification>("Notification", notificationSchema);
