import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri!);
  const db = mongoose.connection.db!;

  const users = await db.collection("user").find({}).toArray();
  const accounts = await db.collection("account").find({}).toArray();

  console.log("USERS:", users.map(u => ({ id: u._id, email: u.email, role: u.role, name: u.name })));
  console.log("ACCOUNTS:", accounts.map(a => ({ id: a._id, userId: a.userId, providerId: a.providerId, accountId: a.accountId })));

  await mongoose.disconnect();
}

main().catch(console.error);
