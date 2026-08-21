import { Request, Response } from "express";
import { usersCollection, safeObjectId } from "./user.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, {
    id: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
    role: req.user!.role,
    avatarUrl: req.user!.image ?? undefined,
  });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const { name, avatarUrl } = req.body as { name?: string; avatarUrl?: string };
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (avatarUrl) update.image = avatarUrl;

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

// --- Admin: user management -------------------------------------------------

export const adminListUsers = asyncHandler(async (req: Request, res: Response) => {
  const { search } = req.query as { search?: string };
  const filter = search ? { $or: [{ name: new RegExp(search, "i") }, { email: new RegExp(search, "i") }] } : {};
  const users = await usersCollection().find(filter).limit(200).toArray();
  res.status(200).json(
    users.map((u) => ({
      id: String(u.id ?? u._id),
      name: u.name,
      email: u.email,
      role: u.role ?? "customer",
      banned: !!u.banned,
      createdAt: u.createdAt,
    }))
  );
});

export const adminSetUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { banned } = req.body as { banned: boolean };
  const objectId = safeObjectId(req.params.id);
  const result = await usersCollection().findOneAndUpdate(
    { $or: [{ id: req.params.id }, ...(objectId ? [{ _id: objectId }] : [])] },
    { $set: { banned } },
    { returnDocument: "after" }
  );
  if (!result) throw ApiError.notFound("User not found");
  sendSuccess(res, { id: String(result.id ?? result._id), banned }, banned ? "User suspended" : "User activated");
});
