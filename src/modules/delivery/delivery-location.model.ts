import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IDeliveryLocation {
  _id: Types.ObjectId;
  deliveryRequestId: string;
  deliveryManId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  recordedAt: Date;
  createdAt: Date;
}

const deliveryLocationSchema = new Schema<IDeliveryLocation>(
  {
    deliveryRequestId: { type: String, required: true, index: true },
    deliveryManId: { type: String, required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number },
    altitude: { type: Number },
    speed: { type: Number },
    heading: { type: Number },
    recordedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

deliveryLocationSchema.index({ deliveryRequestId: 1, recordedAt: -1 });
deliveryLocationSchema.index({ deliveryManId: 1, recordedAt: -1 });

applyToJSON(deliveryLocationSchema);

export const DeliveryLocation = model<IDeliveryLocation>("DeliveryLocation", deliveryLocationSchema);
