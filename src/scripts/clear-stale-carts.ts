/**
 * One-time cleanup script: Handle existing cart items that reference products
 * with variants but don't have variantName set.
 *
 * Strategy: Remove cart items that reference variant-products but have no
 * variantName, since we can't know which variant the user intended.
 * Cart items for products without variants are left untouched.
 *
 * Run: npx ts-node src/scripts/clear-stale-carts.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error("❌ No MONGODB_URI or DATABASE_URL found in environment");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    console.error("❌ Could not access database");
    process.exit(1);
  }

  const carts = db.collection("carts");
  const products = db.collection("products");

  // Find all products that have variants
  const variantProducts = await products
    .find({ "variants.0": { $exists: true } })
    .project({ _id: 1 })
    .toArray();
  const variantProductIds = new Set(variantProducts.map((p) => p._id.toString()));

  console.log(`📦 Found ${variantProductIds.size} products with variants`);

  const cursor = carts.find({ "items.0": { $exists: true } });
  let cartsProcessed = 0;
  let itemsRemoved = 0;

  for await (const cart of cursor) {
    const originalCount = cart.items.length;

    // Keep items that either:
    // 1. Don't reference a variant product (product has no variants)
    // 2. Already have a variantName set
    const cleanedItems = cart.items.filter((item: any) => {
      const hasVariantProduct = variantProductIds.has(String(item.productId));
      const hasVariantName = !!item.variantName;

      if (hasVariantProduct && !hasVariantName) {
        console.log(
          `  🗑️  Cart "${cart.userId}": removing item for product ${item.productId} (variant product without variantName)`
        );
        return false;
      }
      return true;
    });

    if (cleanedItems.length < originalCount) {
      await carts.updateOne(
        { _id: cart._id },
        { $set: { items: cleanedItems } }
      );
      const removed = originalCount - cleanedItems.length;
      itemsRemoved += removed;
      cartsProcessed++;
    }
  }

  console.log(`\n✅ Cleanup complete:`);
  console.log(`   Carts processed: ${cartsProcessed}`);
  console.log(`   Stale items removed: ${itemsRemoved}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
