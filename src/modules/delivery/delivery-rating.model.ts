import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IDeliveryRating {
  _id: Types.ObjectId;
  deliveryRequestId: string;
  orderId: string;
  deliveryManId: string;
  customerId: string;
  rating: number;
  professionalism?: number;
  timeliness?: number;
  communication?: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryRatingSchema = new Schema<IDeliveryRating>(
  {
    deliveryRequestId: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, required: true, index: true },
    deliveryManId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    timeliness: { type: Number, min: 1, max: 5 },
    communication: { type: Number, min: 1, max: 5 },
    comment: { type: String },
  },
  { timestamps: true }
);

deliveryRatingSchema.index({ deliveryManId: 1, createdAt: -1 });

applyToJSON(deliveryRatingSchema);

export const DeliveryRating = model<IDeliveryRating>("DeliveryRating", deliveryRatingSchema);
