import { Request, Response } from "express";
import { usersCollection, safeObjectId } from "./user.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Controller: Get Logged-In User Profile
 *
 * 1. Inputs Extracted:
 *    - req.user: Authenticated session attached by auth middleware
 * 2. Database Operation:
 *    - None needed directly; user identity data is extracted from the active session
 * 3. Response Sent:
 *    - HTTP 200: { id, name, email, role, avatarUrl }
 */
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, {
    id: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
    role: req.user!.role,
    avatarUrl: req.user!.image ?? undefined,
  });
});

/**
 * Controller: Update Profile
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 *    - req.body: name, avatarUrl (optional)
 * 2. Database Operation:
 *    - usersCollection().findOneAndUpdate({ $or: [{ id }, { _id }] }, { $set: update }, { returnDocument: "after" })
 * 3. Response Sent:
 *    - HTTP 200: Updated user profile object { id, name, email, role, avatarUrl }
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const { name, avatarUrl } = req.body as { name?: string; avatarUrl?: string };
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (avatarUrl) update.image = avatarUrl;

  // If nothing changed, return current profile immediately
  if (Object.keys(update).length === 0) {
    return sendSuccess(res, {
      id: req.user!.id,
      name: req.user!.name,
      email: req.user!.email,
      role: req.user!.role,
      avatarUrl: req.user!.image ?? undefined,
    });
  }

  const objectId = safeObjectId(req.user!.id);
  const result = await usersCollection().findOneAndUpdate(
    { $or: [{ id: req.user!.id }, ...(objectId ? [{ _id: objectId }] : [])] },
    { $set: update },
    { returnDocument: "after" }
  );

  if (!result) throw ApiError.notFound("User not found");

  sendSuccess(res, {
    id: String(result.id ?? result._id),
    name: result.name,
    email: result.email,
    role: result.role ?? "customer",
    avatarUrl: result.image ?? undefined,
  });
});

/**
 * Controller: Admin List Users
 *
 * 1. Inputs Extracted:
 *    - req.query.search: Optional search term for user name or email
 * 2. Database Operation:
 *    - usersCollection().find(filter).limit(200).toArray()
 * 3. Response Sent:
 *    - HTTP 200: Array of sanitized user objects { id, name, email, role, banned, createdAt }
 */
export const adminListUsers = asyncHandler(async (req: Request, res: Response) => {
  const { search } = req.query as { search?: string };
  const filter = search
    ? { $or: [{ name: new RegExp(search, "i") }, { email: new RegExp(search, "i") }] }
    : {};

  const users = await usersCollection().find(filter).limit(200).toArray();

  res.status(200).json(
    users.map((u) => ({
      id: String(u.id ?? u._id),
      name: u.name,
      email: u.email,
      role: u.role ?? "customer",
      banned: Boolean(u.banned),
      createdAt: u.createdAt,
    }))
  );
});

/**
 * Controller: Admin Set User Status (Suspend / Activate)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Target user ID
 *    - req.body.banned: Boolean flag indicating if user should be suspended
 * 2. Database Operation:
 *    - usersCollection().findOneAndUpdate({ $or: [{ id }, { _id }] }, { $set: { banned } }, { returnDocument: "after" })
 * 3. Response Sent:
 *    - HTTP 200: { id, banned } with "User suspended" or "User activated" message
 */
export const adminSetUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { banned } = req.body as { banned: boolean };
  const objectId = safeObjectId(req.params.id);

  const result = await usersCollection().findOneAndUpdate(
    { $or: [{ id: req.params.id }, ...(objectId ? [{ _id: objectId }] : [])] },
    { $set: { banned } },
    { returnDocument: "after" }
  );

  if (!result) throw ApiError.notFound("User not found");

  sendSuccess(
    res,
    { id: String(result.id ?? result._id), banned },
    banned ? "User suspended" : "User activated"
  );
});
