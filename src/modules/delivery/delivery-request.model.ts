import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type DeliveryRequestStatus =
  | "available"
  | "assigned"
  | "pickup_started"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "cancelled"
  | "rescheduled";

export interface IDeliveryRequest {
  _id: Types.ObjectId;
  orderId: string;
  sellerId: string;
  customerId: string;
  status: DeliveryRequestStatus;
  assignedDeliveryManId?: string;
  assignedAt?: Date;
  acceptedAt?: Date;
  pickupStartedAt?: Date;
  pickedUpAt?: Date;
  inTransitAt?: Date;
  outForDeliveryAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  deliveryOtp?: string;
  deliveryOtpVerifiedAt?: Date;
  deliveryProofImage?: string;
  deliveryFailedReason?: string;
  deliveryFailedNotes?: string;
  priority: "normal" | "high" | "urgent";
  packageInfo?: {
    weight?: number;
    dimensions?: string;
    specialInstructions?: string;
    fragile?: boolean;
  };
  pickupAddress?: string;
  deliveryAddress?: string;
  pickupContact?: string;
  deliveryContact?: string;
  estimatedDistance?: number;
  deliveryFee?: number;
  sellerNotes?: string;
  cancellationReason?: string;
  cancelledBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryRequestSchema = new Schema<IDeliveryRequest>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    sellerId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: [
        "available",
        "assigned",
        "pickup_started",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "failed",
        "cancelled",
        "rescheduled",
      ],
      default: "available",
      index: true,
    },
    assignedDeliveryManId: { type: String, index: true },
    assignedAt: { type: Date },
    acceptedAt: { type: Date },
    pickupStartedAt: { type: Date },
    pickedUpAt: { type: Date },
    inTransitAt: { type: Date },
    outForDeliveryAt: { type: Date },
    deliveredAt: { type: Date },
    failedAt: { type: Date },
    cancelledAt: { type: Date },
    deliveryOtp: { type: String },
    deliveryOtpVerifiedAt: { type: Date },
    deliveryProofImage: { type: String },
    deliveryFailedReason: { type: String },
    deliveryFailedNotes: { type: String },
    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    packageInfo: {
      weight: { type: Number },
      dimensions: { type: String },
      specialInstructions: { type: String },
      fragile: { type: Boolean, default: false },
    },
    pickupAddress: { type: String },
    deliveryAddress: { type: String },
    pickupContact: { type: String },
    deliveryContact: { type: String },
    estimatedDistance: { type: Number },
    deliveryFee: { type: Number },
    sellerNotes: { type: String },
    cancellationReason: { type: String },
    cancelledBy: { type: String },
  },
  { timestamps: true }
);

deliveryRequestSchema.index({ status: 1, assignedDeliveryManId: 1 });
deliveryRequestSchema.index({ sellerId: 1, status: 1 });
deliveryRequestSchema.index({ customerId: 1, status: 1 });
deliveryRequestSchema.index({ assignedDeliveryManId: 1, status: 1 });

applyToJSON(deliveryRequestSchema);

export const DeliveryRequest = model<IDeliveryRequest>("DeliveryRequest", deliveryRequestSchema);
