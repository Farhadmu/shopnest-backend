import { z } from "zod";

const addressFields = z.object({
  title: z.string().trim().min(1).max(40).optional(),
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  phone: z.string().trim().min(6, "A valid phone number is required").max(30),
  division: z.string().trim().min(2, "Division is required").max(80),
  district: z.string().trim().min(2, "District is required").max(80),
  upazila: z.string().trim().min(2).max(80).optional(),
  city: z.string().trim().max(100).optional(),
  streetAddress: z.string().trim().min(5, "Detailed street address is required").max(500),
  postalCode: z.string().trim().min(4).max(10).optional(),
  addressType: z.enum(["home", "office", "other"]).optional(),
  isDefault: z.boolean().optional(),
});

export const createAddressSchema = addressFields;

export const updateAddressSchema = addressFields.partial().refine(
  (address) => Object.keys(address).length > 0,
  "At least one address field is required"
);
