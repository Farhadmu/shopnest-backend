import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = (process.argv[3]?.trim().toLowerCase() || "admin") as "customer" | "seller" | "admin";

  if (!email) {
    console.error("Usage: npx tsx src/scripts/set-role.ts <user-email> [role]");
    console.error("Example: npx tsx src/scripts/set-role.ts admin@shopnest.com admin");
    process.exit(1);
  }

  if (!["customer", "seller", "admin"].includes(role)) {
    console.error(`Invalid role "${role}". Allowed roles: customer, seller, admin`);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not defined in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("Failed to get database handle");
    process.exit(1);
  }

  const user = await db.collection("user").findOne({ email });
  if (!user) {
    console.error(`User with email "${email}" not found in database! Please register first on the frontend.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  await db.collection("user").updateOne({ email }, { $set: { role } });
  console.log(`✅ Success! User "${email}" role updated to "${role}".`);
  console.log(`You can now log in with ${email} to access the ${role.toUpperCase()} dashboard!`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error setting role:", err);
  process.exit(1);
});
