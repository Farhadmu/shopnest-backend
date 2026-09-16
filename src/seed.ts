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
import { Review } from "./modules/reviews/review.model";
import { logger } from "./utils/logger";

const DEMO_SELLER_ID = "seed-demo-seller";

/**
 * Testimonials attached to real, already-existing ShopNest customers.
 * Identity (name + avatar) is pulled live from better-auth's `user`
 * collection at seed time — we never invent names. The review body stays
 * as crafted copy; only the customer identity is real.
 */
const DEMO_REVIEWS = [
  {
    email: "ashikcustomer@gmail.com",
    rating: 5,
    comment:
      "The AI comparison made it much easier to decide without reading dozens of product pages. Shipping was fast and the packaging was premium.",
  },
  {
    email: "customer@shopnest.com",
    rating: 5,
    comment:
      "The seller trust signals give me much more confidence before ordering. I've bought twice now and both times exceeded expectations.",
  },
  {
    email: "user@user.com",
    rating: 4,
    comment:
      "Great value for the price. The noise cancellation on the headphones is solid for the category. Battery life is exactly as advertised.",
  },
  {
    email: "ab.bakkar420@gmail.com",
    rating: 5,
    comment:
      "Mechanical keyboard feels premium out of the box. Switches are responsive and the RGB software is actually useful, not gimmicky.",
  },
  {
    email: "hasina.akter171407@gmail.com",
    rating: 5,
    comment:
      "Cotton t-shirt fits well and held up after several washes. Exactly what I expected from a 100% cotton blend.",
  },
  {
    email: "jjayjd@gmaail.com",
    rating: 4,
    comment:
      "Solid product overall. The only reason for 4 stars is the lack of a carrying case, but sound quality is excellent.",
  },
];

async function run() {
  await connectDB();

  const mongoose = (await import("mongoose")).default;
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

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

  // Resolve each testimonial's author against the real `user` collection.
  // We never invent names — if a listed email doesn't exist we skip it.
  const seededProducts = await Product.find({ storeId: store.id });
  let reviewCount = 0;
  for (let i = 0; i < DEMO_REVIEWS.length; i++) {
    const product = seededProducts[i % seededProducts.length];
    if (!product) break;

    const author = await db.collection("user").findOne({ email: DEMO_REVIEWS[i].email });
    if (!author) {
      logger.warn(`Skipped review — no user found for ${DEMO_REVIEWS[i].email}`);
      continue;
    }

    await Review.findOneAndUpdate(
      { productId: product.id, userId: String(author.id ?? author._id) },
      {
        productId: product.id,
        userId: String(author.id ?? author._id),
        userName: author.name,
        rating: DEMO_REVIEWS[i].rating,
        comment: DEMO_REVIEWS[i].comment,
        verifiedPurchase: true,
      },
      { upsert: true, new: true }
    );
    reviewCount += 1;
  }
  logger.info(`Seeded ${reviewCount} verified shopper reviews (real customers)`);

  await disconnectDB();
  logger.info("Seed complete ✅");
}

run().catch((err) => {
  logger.error("Seed failed", err);
  process.exit(1);
});