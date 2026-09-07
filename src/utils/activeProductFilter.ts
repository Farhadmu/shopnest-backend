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
