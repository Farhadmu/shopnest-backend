import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import mongoose from "mongoose";
import { env } from "../config/env";
import { Category } from "../modules/categories/category.model";
import { Store } from "../modules/sellers/store.model";
import { logger } from "../utils/logger";

const BASE_CATEGORIES = [
  { name: "Electronics", slug: "electronics", image: "/assets/categories/electronics.png" },
  { name: "Fashion", slug: "fashion", image: "/assets/categories/fashion.png" },
  { name: "Home & Living", slug: "home-living", image: "/assets/categories/home.png" },
  { name: "Beauty", slug: "beauty", image: "/assets/categories/beauty.png" },
  { name: "Sports", slug: "sports", image: "/assets/categories/sports.png" },
  { name: "Books", slug: "books", image: "/assets/categories/books.png" },
  { name: "Groceries", slug: "groceries", image: "/assets/categories/groceries.png" },
];

async function seedAndAssignCategories() {
  try {
    await mongoose.connect(env.MONGODB_URI, { dbName: env.DB_NAME });
    logger.info("Connected to MongoDB");

    // 1. Ensure all base categories exist
    const categoryDocs = [];
    for (const cat of BASE_CATEGORIES) {
      let doc = await Category.findOne({ slug: cat.slug });
      if (!doc) {
        doc = await Category.create(cat);
        logger.info(`Created category: ${cat.name}`);
      }
      categoryDocs.push(doc);
    }

    const catMapByName = new Map(categoryDocs.map((c) => [c.name.toLowerCase(), c]));

    // 2. Fetch all stores in DB
    const stores = await Store.find();
    logger.info(`Found ${stores.length} stores in database.`);

    for (let i = 0; i < stores.length; i++) {
      const store = stores[i];
      const name = (store.storeName || "").toLowerCase();
      const desc = (store.description || "").toLowerCase();
      const combined = `${name} ${desc}`;

      let targetCat = categoryDocs[i % categoryDocs.length]; // round robin fallback

      if (combined.includes("tech") || combined.includes("electro") || combined.includes("gadget") || combined.includes("phone") || combined.includes("digital") || combined.includes("apex")) {
        targetCat = catMapByName.get("electronics") || targetCat;
      } else if (combined.includes("fashion") || combined.includes("cloth") || combined.includes("wear") || combined.includes("apparel") || combined.includes("style") || combined.includes("trend")) {
        targetCat = catMapByName.get("fashion") || targetCat;
      } else if (combined.includes("home") || combined.includes("decor") || combined.includes("living") || combined.includes("kitchen") || combined.includes("furnitur")) {
        targetCat = catMapByName.get("home & living") || targetCat;
      } else if (combined.includes("beauty") || combined.includes("glow") || combined.includes("skin") || combined.includes("cosmetic") || combined.includes("care")) {
        targetCat = catMapByName.get("beauty") || targetCat;
      } else if (combined.includes("sport") || combined.includes("fit") || combined.includes("gym") || combined.includes("outdoor")) {
        targetCat = catMapByName.get("sports") || targetCat;
      } else if (combined.includes("book") || combined.includes("read") || combined.includes("print") || combined.includes("library")) {
        targetCat = catMapByName.get("books") || targetCat;
      } else if (combined.includes("grocer") || combined.includes("food") || combined.includes("organic") || combined.includes("mart") || combined.includes("shopnest")) {
        targetCat = catMapByName.get("groceries") || targetCat;
      }

      if (!store.businessInfo) {
        store.businessInfo = {};
      }

      store.businessInfo.categoryId = targetCat._id;
      await store.save();
      logger.info(`Assigned store "${store.storeName}" -> Category: "${targetCat.name}" (${targetCat._id})`);
    }

    logger.info("Category assignment completed successfully!");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    logger.error("Category seeding failed", err);
    process.exit(1);
  }
}

seedAndAssignCategories();
