/**
 * Seeds a handful of categories and a demo store + products so the frontend
 * has something to render immediately. Safe to re-run (idempotent upserts).
 *
 * Usage: npm run seed
 *
 * NOTE: this does NOT create any users - accounts must be created via the
 * frontend's better-auth sign-up flow (or directly in the `user` collection)
 * since identity is owned there, not by this backend.
 */
import { connectDB, disconnectDB } from "./config/db";
import { Category } from "./modules/categories/category.model";
import { Store } from "./modules/sellers/store.model";
import { Product } from "./modules/products/product.model";
import { logger } from "./utils/logger";

const DEMO_SELLER_ID = "seed-demo-seller";

async function run() {
  await connectDB();

  const categories = ["Electronics", "Fashion", "Home & Kitchen", "Beauty", "Sports", "Books"];
  for (const name of categories) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await Category.findOneAndUpdate({ slug }, { name, slug }, { upsert: true, new: true });
  }
  logger.info(`Seeded ${categories.length} categories`);

  let store = await Store.findOne({ ownerId: DEMO_SELLER_ID });
  if (!store) {
    store = await Store.create({
      ownerId: DEMO_SELLER_ID,
      storeName: "Tech World",
      slug: "tech-world",
      description: "Your trusted source for electronics and gadgets.",
      status: "approved",
      trustScore: 78,
    });
  }
  logger.info(`Demo store ready: ${store.storeName} (${store.id})`);

  const demoProducts = [
    {
      title: "Wireless Bluetooth Headphones",
      description: "Over-ear wireless headphones with 30-hour battery life and active noise cancellation.",
      price: 4500,
      category: "Electronics",
      stock: 25,
      tags: ["headphones", "wireless", "audio", "gaming", "music"],
    },
    {
      title: "Mechanical Gaming Keyboard",
      description: "RGB backlit mechanical keyboard with blue switches, built for competitive gaming.",
      price: 3200,
      category: "Electronics",
      stock: 40,
      tags: ["keyboard", "gaming", "mechanical", "rgb"],
    },
    {
      title: "Slim Fit Cotton T-Shirt",
      description: "Breathable 100% cotton t-shirt, available in multiple colors.",
      price: 650,
      category: "Fashion",
      stock: 100,
      tags: ["tshirt", "cotton", "casual"],
    },
  ];

  for (const p of demoProducts) {
    await Product.findOneAndUpdate(
      { title: p.title, storeId: store.id },
      { ...p, storeId: store.id, sellerId: store.ownerId, status: "approved" },
      { upsert: true, new: true }
    );
  }
  logger.info(`Seeded ${demoProducts.length} demo products`);

  await disconnectDB();
  logger.info("Seed complete ✅");
}

run().catch((err) => {
  logger.error("Seed failed", err);
  process.exit(1);
});
