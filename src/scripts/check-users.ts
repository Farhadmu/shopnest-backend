import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is missing");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No db handle");
    process.exit(1);
  }

  const users = await db.collection("user").find({}).project({ email: 1, name: 1, role: 1 }).toArray();
  console.log("USERS_IN_DB:", JSON.stringify(users, null, 2));

  await mongoose.disconnect();
}

main().catch(console.error);
