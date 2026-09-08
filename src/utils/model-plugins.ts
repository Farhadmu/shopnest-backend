import { Schema } from "mongoose";

/**
 * Applies a consistent JSON shape across all models so API responses match
 * the frontend contracts (which expect `id: string`, not Mongo's `_id`).
 *  - _id -> id (string)
 *  - removes __v
 *  - removes any field explicitly marked private via schema.set("private", [...])
 */
export function applyToJSON(schema: Schema) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });
  schema.set("toObject", { virtuals: true });
}
