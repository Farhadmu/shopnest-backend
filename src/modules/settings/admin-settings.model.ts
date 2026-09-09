import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

/**
 * Platform-wide admin configuration. Currently a single document (singleton)
 * holding the global cap on how many product categories may be
 * locked/assigned to sellers at once via approved "specific-category"
 * homepage coupon requests.
 */
export interface IAdminSettings {
  _id: Types.ObjectId;
  category_length: number;
  createdAt: Date;
  updatedAt: Date;
}

const adminSettingsSchema = new Schema<IAdminSettings>(
  {
    category_length: { type: Number, required: true, default: 10, min: 1 },
  },
  { timestamps: true }
);

applyToJSON(adminSettingsSchema);

export const AdminSettings = model<IAdminSettings>("AdminSettings", adminSettingsSchema);

/** Fetches the singleton settings doc, creating it with defaults on first access. */
export async function getSettingsSingleton() {
  let settings = await AdminSettings.findOne();
  if (!settings) {
    settings = await AdminSettings.create({ category_length: 10 });
  }
  return settings;
}
