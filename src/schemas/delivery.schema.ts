import { z } from "zod";
import { DeliveryRequestStatus } from "../modules/delivery/delivery-request.model";

const optionalDate = z.preprocess((val) => {
  if (!val || val === "" || val === null || val === undefined) return undefined;
  return val;
}, z.coerce.date().optional());

const optionalEmail = z.preprocess((val) => {
  if (!val || val === "" || val === null || val === undefined) return undefined;
  return val;
}, z.string().email().optional());

export const createOrUpdateProfileSchema = z.object({
  personal: z
    .object({
      fullName: z.string().min(1, "Full name is required").optional(),
      phone: z.string().min(1, "Phone is required").optional(),
      alternatePhone: z.string().optional(),
      email: optionalEmail,
      dateOfBirth: optionalDate,
      gender: z.string().optional(),
      emergencyContactName: z.string().optional(),
      emergencyContactPhone: z.string().optional(),
      currentAddress: z.string().optional(),
      permanentAddress: z.string().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
      serviceArea: z.array(z.string()).optional(),
      profilePhoto: z.string().optional(),
    })
    .optional(),
  identity: z
    .object({
      nidNumber: z.string().optional(),
      nidType: z.string().optional(),
      nidFrontImage: z.string().optional(),
      nidBackImage: z.string().optional(),
      selfieImage: z.string().optional(),
    })
    .optional(),
  license: z
    .object({
      licenseNumber: z.string().optional(),
      licenseType: z.string().optional(),
      licenseExpiryDate: optionalDate,
      licenseFrontImage: z.string().optional(),
      licenseBackImage: z.string().optional(),
      drivingExperience: z.number().min(0).optional(),
      vehicleExperience: z.string().optional(),
    })
    .optional(),
  vehicle: z
    .object({
      vehicleType: z.enum(["motorcycle", "bicycle", "car", "van", "other"]).optional(),
      vehicleBrand: z.string().optional(),
      vehicleModel: z.string().optional(),
      vehicleColor: z.string().optional(),
      vehicleRegistrationNumber: z.string().optional(),
      vehicleRegistrationDocument: z.string().optional(),
      vehicleOwnershipType: z.enum(["owned", "rented", "company_provided"]).optional(),
      vehiclePhoto: z.string().optional(),
      vehicleFrontPhoto: z.string().optional(),
      vehicleBackPhoto: z.string().optional(),
      vehicleFitnessExpiryDate: optionalDate,
      vehicleCapacity: z.number().min(1).optional(),
      packageCapacity: z.number().min(1).optional(),
      weightCapacityKg: z.number().min(1).optional(),
      volumeCapacityLiters: z.number().min(1).optional(),
    })
    .optional(),
  bank: z
    .object({
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
      accountHolderName: z.string().optional(),
      branchName: z.string().optional(),
      routingNumber: z.string().optional(),
      mobileBankingProvider: z.enum(["bkash", "nagad", "rocket", "bank"]).optional(),
      mobileBankingNumber: z.string().optional(),
    })
    .optional(),
  preferences: z
    .object({
      preferredServiceZones: z.array(z.string()).optional(),
      maxActiveDeliveries: z.number().min(1).default(3),
      preferredVehicleType: z.string().optional(),
      availabilityPreference: z.enum(["full_time", "part_time", "weekends", "on_call"]).optional(),
      deliveryRadius: z.number().min(0).optional(),
    })
    .optional(),
});

export const setAvailabilitySchema = z.object({
  availabilityStatus: z.enum(["offline", "available", "busy", "full_capacity", "on_break", "suspended"]).optional(),
  isActive: z.boolean().optional(),
});

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.enum([
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
  ]) as z.ZodType<DeliveryRequestStatus>,
});

export const updateReverseDeliveryStatusSchema = z.object({
  status: z.enum([
    "available",
    "assigned",
    "accepted",
    "pickup_started",
    "picked_up",
    "in_transit",
    "seller_received",
    "failed",
    "cancelled",
  ]),
  failureReason: z.string().optional(),
  deliveryOtp: z.string().optional(),
  deliveryProofImage: z.string().optional(),
  note: z.string().optional(),
});

export const verifyOtpSchema = z.object({
  otp: z.string().length(6, "OTP must be 6 digits"),
});

const incidentCategoryEnum = z.enum([
  "customer_unavailable",
  "wrong_address",
  "customer_refused",
  "cannot_contact_customer",
  "access_problem",
  "vehicle_problem",
  "vehicle_breakdown",
  "accident",
  "package_issue",
  "package_damaged",
  "traffic",
  "traffic_delay",
  "severe_traffic",
  "weather",
  "severe_weather",
  "seller_issue",
  "safety_issue",
  "technical_issue",
  "other",
]);

export const reportIncidentSchema = z.object({
  category: incidentCategoryEnum,
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  description: z.string().min(5, "Description is required"),
  evidenceImages: z.array(z.string()).optional(),
  returnRequestId: z.string().optional(),
  reverseDeliveryRequestId: z.string().optional(),
  productId: z.string().optional(),
});

export const createIncidentSchema = z.object({
  deliveryRequestId: z.string().optional(),
  reverseDeliveryRequestId: z.string().optional(),
  returnRequestId: z.string().optional(),
  orderId: z.string().optional(),
  productId: z.string().optional(),
  category: incidentCategoryEnum,
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  description: z.string().min(5, "Description is required"),
  evidenceImages: z.array(z.string()).optional(),
});

export const rateDeliverySchema = z.object({
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5"),
  professionalism: z.number().int().min(1).max(5).optional(),
  timeliness: z.number().int().min(1).max(5).optional(),
  communication: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
});
