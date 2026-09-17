import mongoose from "mongoose";
import { Product } from "../modules/products/product.model";
import { Store, StoreStatus } from "../modules/sellers/store.model";

/**
 * The base filter for products that are live and purchasable — not deleted,
 * and approved by an admin. Spread this into a larger query filter instead
 * of repeating `{ isDeleted: false, status: "approved" }` at every call site.
 *
 * Example: `Product.find({ ...ACTIVE_PRODUCT_FILTER, category })`
 */
export const ACTIVE_PRODUCT_FILTER = {
  isDeleted: false,
  status: "approved",
} as const;

/**
 * Store statuses whose products must never show up in public listings or
 * single-product detail fetches.
 */
export const EXCLUDED_STORE_STATUSES: readonly StoreStatus[] = ["suspended", "rejected"];

export async function getPublicProduct(productId: string) {
  const product = await Product.findOne({ _id: productId, ...ACTIVE_PRODUCT_FILTER }).lean();
  if (!product) {
    return null;
  }

  const store = mongoose.isValidObjectId(product.storeId)
    ? await Store.findById(product.storeId).select("status").lean()
    : await Store.findOne({
        $or: [
          { slug: String(product.storeId).toLowerCase() },
          { ownerId: product.storeId },
        ],
      })
        .select("status")
        .lean();

  if (!store || EXCLUDED_STORE_STATUSES.includes(store.status)) {
    return null;
  }

  return product;
}

export async function buildPublicProductFilter(
  additionalFilter: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return {
    ...additionalFilter,
    ...ACTIVE_PRODUCT_FILTER,
    storeSuspended: false,
  };
}
