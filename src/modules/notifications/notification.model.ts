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
  | "flash_sale"
  | "security_alert"
  | "incident_alert"
  | "payment_alert"
  | "refund_alert"
  | "delivery_alert"
  | "inventory_alert"
  | "system_alert"
  | "ai_insight"
  | "admin_alert";

export type NotificationCategory =
  | "orders"
  | "sellers"
  | "reviews"
  | "security"
  | "incidents"
  | "payments"
  | "refunds"
  | "delivery"
  | "inventory"
  | "system"
  | "ai_insights";

export type NotificationPriority = "info" | "warning" | "high" | "critical";

export type NotificationSource =
  | "order"
  | "seller"
  | "review"
  | "security"
  | "incident"
  | "payment"
  | "refund"
  | "delivery"
  | "inventory"
  | "system"
  | "ai"
  | "admin";

export type NotificationRelatedType =
  | "order"
  | "seller"
  | "review"
  | "incident"
  | "security_event"
  | "product"
  | "user"
  | "delivery"
  | "payment"
  | "refund"
  | "system";

export type RecipientType = "user" | "seller" | "admin" | "all";

export interface INotification {
  _id: Types.ObjectId;
  userId: string;
  recipientType?: RecipientType;
  type: NotificationType;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  source?: NotificationSource;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  relatedId?: string;
  relatedType?: NotificationRelatedType;
  createdAt: Date;
  updatedAt: Date;
  toJSON(): Record<string, unknown>;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    recipientType: { type: String, enum: ["user", "seller", "admin", "all"], default: "user", index: true },
    type: { type: String, required: true, index: true },
    category: { type: String, enum: ["orders", "sellers", "reviews", "security", "incidents", "payments", "refunds", "delivery", "inventory", "system", "ai_insights"], index: true },
    priority: { type: String, enum: ["info", "warning", "high", "critical"], default: "info", index: true },
    source: { type: String, enum: ["order", "seller", "review", "security", "incident", "payment", "refund", "delivery", "inventory", "system", "ai", "admin"], index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    isRead: { type: Boolean, default: false, index: true },
    link: { type: String },
    relatedId: { type: String, index: true },
    relatedType: { type: String, enum: ["order", "seller", "review", "incident", "security_event", "product", "user", "delivery", "payment", "refund", "system"], index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientType: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ category: 1, priority: 1, createdAt: -1 });
applyToJSON(notificationSchema);

export const Notification = model<INotification>("Notification", notificationSchema);
