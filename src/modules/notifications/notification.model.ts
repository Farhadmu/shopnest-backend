import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type NotificationType =
  | "order_confirmation"
  | "order_shipped"
  | "order_delivered"
  | "order_update"
  | "order_cancelled"
  | "return_update"
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
  toJSON(): Record<string, unknown>;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    isRead: { type: Boolean, default: false, index: true },
    link: { type: String },
    relatedId: { type: String, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
applyToJSON(notificationSchema);

export const Notification = model<INotification>("Notification", notificationSchema);
