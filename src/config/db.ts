import { Resolver } from "dns";
import { setServers } from "dns";
import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

// Override the default DNS servers to use Google's public DNS.
// The local router DNS (192.168.0.1) often fails MongoDB SRV record lookups
// from Node.js, causing ECONNREFUSED on querySrv.
setServers(["8.8.8.8", "8.8.4.4"]);
void Resolver; // imported for side-effect awareness only

mongoose.set("strictQuery", true);

export async function connectDB(): Promise<void> {
  mongoose.connection.on("connected", () => {
    logger.info(`MongoDB connected -> ${mongoose.connection.name}`);
  });

  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error", err);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  await mongoose.connect(env.MONGODB_URI);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
