/**
 * Migration script:
 * 1. Migrate legacy specifications["Variants"] into product.variants[] if needed.
 * 2. Strip dual-storage "Variants" key from product.specifications.
 * 3. Ensure all variants have absolute prices and meaningful SKUs.
 * 4. Recompute and resync top-level product.stock = sum of variants' stocks.
 *
 * Run: npx ts-node src/scripts/migrate-variants.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

function generateVariantSku(productTitle: string, variantName: string): string {
  const cleanTitle = (productTitle || "PROD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const cleanVar = (variantName || "VAR")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return `${cleanTitle || "PROD"}-${cleanVar || "VAR"}`;
}

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

  const products = db.collection("products");
  const cursor = products.find({});

  let updatedCount = 0;
  let totalCount = 0;

  for await (const product of cursor) {
    totalCount++;
    let needsUpdate = false;
    const basePrice = product.discountPrice ?? product.price ?? 0;

    let variants: any[] = Array.isArray(product.variants) ? [...product.variants] : [];
    const specs = product.specifications || {};

    // 1. Dual storage cleanup: check if specifications has "Variants"
    if (specs["Variants"] || specs["variants"]) {
      needsUpdate = true;
      if (variants.length === 0) {
        const raw = specs["Variants"] || specs["variants"];
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            variants = parsed.map((v) => ({
              name: v.name || "",
              stock: Number(v.stock) || 0,
              price: Number(v.price) || basePrice,
              color: v.swatch || v.color,
            }));
          }
        } catch {
          // ignore malformed json
        }
      }
      delete specs["Variants"];
      delete specs["variants"];
    }

    // 2. Validate and clean variants
    const cleanedVariants: any[] = [];
    const seenNames = new Set<string>();

    for (const v of variants) {
      const name = (v.name || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (seenNames.has(lower)) continue; // skip duplicates
      seenNames.add(lower);

      const price = v.price && Number(v.price) > 0 ? Number(v.price) : basePrice;
      const sku = v.sku && typeof v.sku === "string" && !v.sku.startsWith("var_")
        ? v.sku.trim().toUpperCase()
        : generateVariantSku(product.title, name);

      if (v.price !== price || v.sku !== sku || v.name !== name) {
        needsUpdate = true;
      }

      cleanedVariants.push({
        name,
        sku,
        stock: Math.max(0, Number(v.stock) || 0),
        price,
        color: v.color || v.swatch || undefined,
      });
    }

    // 3. Stock resync
    let newStock = product.stock;
    if (cleanedVariants.length > 0) {
      const variantSum = cleanedVariants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      if (product.stock !== variantSum) {
        needsUpdate = true;
        newStock = variantSum;
      }
    }

    if (needsUpdate) {
      await products.updateOne(
        { _id: product._id },
        {
          $set: {
            variants: cleanedVariants,
            specifications: specs,
            stock: newStock,
          },
        }
      );
      updatedCount++;
    }
  }

  console.log(`\n✅ Migration complete:`);
  console.log(`   Scanned: ${totalCount} products`);
  console.log(`   Updated: ${updatedCount} products`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
