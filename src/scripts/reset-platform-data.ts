import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Collections to keep intact:
const PRESERVE_COLLECTIONS = new Set(["products", "categories"]);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is missing from environment");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database connection handle");
    process.exit(1);
  }

  console.log("==========================================");
  console.log("RESETTING ALL USER, SELLER & ORDER DATA TO ZERO");
  console.log("PRESERVING PRODUCTS & CATEGORIES INTACT");
  console.log("==========================================");

  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    if (!PRESERVE_COLLECTIONS.has(col.name)) {
      const count = await db.collection(col.name).countDocuments();
      await db.collection(col.name).deleteMany({});
      console.log(`Deleted ${count} documents from collection '${col.name}'`);
    } else {
      const count = await db.collection(col.name).countDocuments();
      console.log(`PRESERVED collection '${col.name}' with ${count} items`);
    }
  }

  console.log("\nAll user, seller, order, cart, session, and audit collections have been reset to 0.");
  await mongoose.disconnect();
}

main().catch(console.error);
