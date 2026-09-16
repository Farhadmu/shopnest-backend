import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export type DeliveryManStatus = "pending_verification" | "approved" | "rejected" | "suspended";

export interface IDeliveryManProfile {
  _id: Types.ObjectId;
  userId: string;
  status: DeliveryManStatus;
  rejectionReason?: string;
  resubmissionRequired?: boolean;
  verifiedAt?: Date;
  verifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeliveryManPersonalInfo {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  dateOfBirth?: Date;
  gender?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  currentAddress?: string;
  permanentAddress?: string;
  city?: string;
  district?: string;
  serviceArea?: string[];
  profilePhoto?: string;
}

export interface IDeliveryManIdentityInfo {
  nidNumber?: string;
  nidType?: string;
  nidFrontImage?: string;
  nidBackImage?: string;
  selfieImage?: string;
}

export interface IDeliveryManLicenseInfo {
  licenseNumber?: string;
  licenseType?: string;
  licenseExpiryDate?: Date;
  licenseFrontImage?: string;
  licenseBackImage?: string;
  drivingExperience?: number;
  vehicleExperience?: string;
}

export interface IDeliveryManVehicleInfo {
  vehicleType?: "motorcycle" | "bicycle" | "car" | "van" | "other";
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleRegistrationNumber?: string;
  vehicleRegistrationDocument?: string;
  vehicleOwnershipType?: "owned" | "rented" | "company_provided";
  vehiclePhoto?: string;
  vehicleFrontPhoto?: string;
  vehicleBackPhoto?: string;
  vehicleFitnessExpiryDate?: Date;
  vehicleCapacity?: number;
}

export interface IDeliveryManBankInfo {
  bankName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  branchName?: string;
  routingNumber?: string;
  mobileBankingProvider?: "bkash" | "nagad" | "rocket" | "bank";
  mobileBankingNumber?: string;
}

export interface IDeliveryManPreferences {
  preferredServiceZones?: string[];
  maxActiveDeliveries?: number;
  preferredVehicleType?: string;
  availabilityPreference?: "full_time" | "part_time" | "weekends" | "on_call";
  deliveryRadius?: number;
}

const deliveryManProfileSchema = new Schema<IDeliveryManProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending_verification", "approved", "rejected", "suspended"],
      default: "pending_verification",
      index: true,
    },
    rejectionReason: { type: String },
    resubmissionRequired: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
  },
  { timestamps: true }
);

const deliveryManPersonalSchema = new Schema<IDeliveryManPersonalInfo>({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  alternatePhone: { type: String },
  email: { type: String },
  dateOfBirth: { type: Date },
  gender: { type: String },
  emergencyContactName: { type: String },
  emergencyContactPhone: { type: String },
  currentAddress: { type: String },
  permanentAddress: { type: String },
  city: { type: String },
  district: { type: String },
  serviceArea: { type: [String], default: [] },
  profilePhoto: { type: String },
});

const deliveryManIdentitySchema = new Schema<IDeliveryManIdentityInfo>({
  nidNumber: { type: String },
  nidType: { type: String },
  nidFrontImage: { type: String },
  nidBackImage: { type: String },
  selfieImage: { type: String },
});

const deliveryManLicenseSchema = new Schema<IDeliveryManLicenseInfo>({
  licenseNumber: { type: String },
  licenseType: { type: String },
  licenseExpiryDate: { type: Date },
  licenseFrontImage: { type: String },
  licenseBackImage: { type: String },
  drivingExperience: { type: Number, min: 0 },
  vehicleExperience: { type: String },
});

const deliveryManVehicleSchema = new Schema<IDeliveryManVehicleInfo>({
  vehicleType: {
    type: String,
    enum: ["motorcycle", "bicycle", "car", "van", "other"],
  },
  vehicleBrand: { type: String },
  vehicleModel: { type: String },
  vehicleColor: { type: String },
  vehicleRegistrationNumber: { type: String },
  vehicleRegistrationDocument: { type: String },
  vehicleOwnershipType: {
    type: String,
    enum: ["owned", "rented", "company_provided"],
  },
  vehiclePhoto: { type: String },
  vehicleFrontPhoto: { type: String },
  vehicleBackPhoto: { type: String },
  vehicleFitnessExpiryDate: { type: Date },
  vehicleCapacity: { type: Number, min: 1 },
});

const deliveryManBankSchema = new Schema<IDeliveryManBankInfo>({
  bankName: { type: String },
  accountNumber: { type: String },
  accountHolderName: { type: String },
  branchName: { type: String },
  routingNumber: { type: String },
  mobileBankingProvider: {
    type: String,
    enum: ["bkash", "nagad", "rocket", "bank"],
  },
  mobileBankingNumber: { type: String },
});

const deliveryManPreferencesSchema = new Schema<IDeliveryManPreferences>({
  preferredServiceZones: { type: [String], default: [] },
  maxActiveDeliveries: { type: Number, default: 3, min: 1 },
  preferredVehicleType: { type: String },
  availabilityPreference: {
    type: String,
    enum: ["full_time", "part_time", "weekends", "on_call"],
    default: "part_time",
  },
  deliveryRadius: { type: Number, min: 0 },
});

const deliveryManDetailsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    personal: { type: deliveryManPersonalSchema },
    identity: { type: deliveryManIdentitySchema },
    license: { type: deliveryManLicenseSchema },
    vehicle: { type: deliveryManVehicleSchema },
    bank: { type: deliveryManBankSchema },
    preferences: { type: deliveryManPreferencesSchema, default: {} },
    isActive: { type: Boolean, default: false },
    availabilityStatus: {
      type: String,
      enum: ["offline", "available", "busy"],
      default: "offline",
    },
    currentLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      updatedAt: { type: Date },
    },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    totalDeliveries: { type: Number, default: 0 },
    completedDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
  },
  { timestamps: true }
);

deliveryManDetailsSchema.index({ userId: 1 });
deliveryManDetailsSchema.index({ status: 1 });
deliveryManDetailsSchema.index({ "vehicle.vehicleType": 1 });

applyToJSON(deliveryManProfileSchema);
applyToJSON(deliveryManDetailsSchema);

export const DeliveryManProfile = model<IDeliveryManProfile>("DeliveryManProfile", deliveryManProfileSchema);
export const DeliveryManDetails = model("DeliveryManDetails", deliveryManDetailsSchema);
