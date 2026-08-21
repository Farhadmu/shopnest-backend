import mongoose from "mongoose";

/**
 * There is intentionally NO Mongoose model for users here: identity is
 * owned by better-auth (see middlewares/auth.middleware.ts). We read/write
 * the "user" collection it manages directly through the native driver so
 * we never fight betterAuth's own schema/migrations.
 */
export function usersCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");
  return db.collection("user");
}

export function safeObjectId(id: string) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}
