import { Schema, Types } from 'mongoose';

/**
 * Applies a consistent JSON shape across all models so API responses match
 * the frontend contracts (which expect `id: string`, not Mongo's `_id`).
 *  - _id -> id (string)
 *  - removes __v
 */
export function applyToJSON(schema: Schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true });
}

/**
 * Normalize a plain object (or array) returned by .lean() to the same shape
 * that applyToJSON produces: adds `id` from `_id`, removes `_id` and `__v`.
 * Use this whenever you need .lean() performance but still need the frontend-
 * compatible `id` field in the response.
 */
export function normalizeLean<T extends Record<string, unknown>>(
  doc: T
): Omit<T, '_id' | '__v'> & { id: string } {
  const { _id, __v, ...rest } = doc as T & { _id?: Types.ObjectId | string; __v?: number };
  return { ...rest, id: String(_id) } as Omit<T, '_id' | '__v'> & { id: string };
}

export function normalizeLeanArray<T extends Record<string, unknown>>(
  docs: T[]
): Array<Omit<T, '_id' | '__v'> & { id: string }> {
  return docs.map(normalizeLean);
}
