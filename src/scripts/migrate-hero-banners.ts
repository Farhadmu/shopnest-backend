import mongoose from "mongoose";
import { env } from "../config/env";
import { HeroBanner } from "../modules/hero-banners/hero-banner.model";
import { logger } from "../utils/logger";

async function run() {
  try {
    await mongoose.connect(env.MONGODB_URI, { dbName: env.DB_NAME });
    logger.info("Connected to MongoDB for hero-banner migration");

    await HeroBanner.syncIndexes();
    logger.info("HeroBanner indexes synced");

    const count = await HeroBanner.countDocuments();
    logger.info(`HeroBanner collection ready. Existing banners: ${count}`);

    await mongoose.disconnect();
    logger.info("Migration complete");
    process.exit(0);
  } catch (err) {
    logger.error("Hero-banner migration failed", err);
    process.exit(1);
  }
}

run();
