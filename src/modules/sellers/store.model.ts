import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";
import { Category } from "../categories/category.model";

export type StoreStatus = "pending" | "approved" | "rejected" | "suspended";

export interface IStore {
  _id: Types.ObjectId;
  ownerId: string;
  storeName: string;
  slug: string;
  description: string;
  logo?: string;
  banner?: string;
  businessInfo?: {
    ownerName?: string;
    contactPhone?: string;
    businessAddress?: string;
    nidOrTradeLicense?: string;
    taxId?: string;
    categoryId?: Types.ObjectId;
    payoutMethod?: "bank" | "bkash" | "nagad" | "rocket" | string;
    payoutAccountNumber?: string;
    payoutAccountName?: string;
    bankBranch?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  rejectionReason?: string;
  verifiedAt?: Date;
  verifiedBy?: string;
  status: StoreStatus;
  trustScore: number;
  rating: number;
  ratingCount: number;
  followersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const storeSchema = new Schema<IStore>(
  {
    ownerId: { type: String, required: true, index: true, unique: true },
    storeName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, required: true },
    logo: { type: String },
    banner: { type: String },
    businessInfo: {
      ownerName: String,
      contactPhone: String,
      businessAddress: String,
      nidOrTradeLicense: String,
      taxId: String,
      categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
      payoutMethod: String,
      payoutAccountNumber: String,
      payoutAccountName: String,
      bankBranch: String,
    },
    rejectionReason: { type: String },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
    status: { type: String, enum: ["pending", "approved", "rejected", "suspended"], default: "pending" },
    trustScore: { type: Number, default: 60, min: 0, max: 100 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Pre-save hook to migrate legacy `category` (string) to `categoryId` (ObjectId)
storeSchema.pre('save', async function (next) {
  const store = this as any;
  const bi = store.businessInfo;
  if (bi && bi.category && !bi.categoryId) {
    // Legacy string category found, try to find matching Category by name or slug
    try {
      const legacyCategory = bi.category as string;
      const matched = await Category.findOne({
        $or: [{ name: legacyCategory }, { slug: legacyCategory.toLowerCase().replace(/\s+/g, '-') }]
      }).select('_id').lean();
      if (matched) {
        bi.categoryId = matched._id;
      }
      // Remove legacy field
      delete bi.category;
    } catch {
      // Ignore migration errors, leave categoryId unset
      delete bi.category;
    }
  }
  next();
});

applyToJSON(storeSchema);

export const Store = model<IStore>("Store", storeSchema);
