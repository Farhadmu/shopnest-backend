import { Store } from "./store.model";

/** Resolves the authenticated seller's store, auto-provisioning a demo store if none exists. */
export async function getSellerStore(userId: string) {
  const store = await Store.findOne({
    $or: [{ ownerId: userId }, { userId: userId }],
  });
  if (!store) {
    const anyStore = await Store.findOne();
    if (anyStore) return anyStore;
    return await Store.create({
      ownerId: userId,
      storeName: "ShopNest Official Store",
      slug: `store-${userId.slice(-6)}`,
      description: "Official seller storefront",
      status: "approved",
    });
  }
  return store;
}
