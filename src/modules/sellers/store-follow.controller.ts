import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/async-handler";
import { ApiError } from "../../utils/api-error";
import { sendSuccess } from "../../utils/api-response";
import { Store } from "./store.model";
import { StoreFollow } from "./store-follow.model";

async function resolveStore(identifier: string) {
  return Store.findOne({
    $or: [
      { slug: identifier.toLowerCase() },
      ...(mongoose.isValidObjectId(identifier) ? [{ _id: identifier }] : []),
    ],
    status: "approved",
  }).select("_id").lean();
}

export const getFollowStatus = asyncHandler(async (req: Request, res: Response) => {
  const store = await resolveStore(req.params.storeId);
  if (!store) throw ApiError.notFound("Store not found");
  const storeId = store._id.toString();
  const follow = await StoreFollow.exists({ userId: req.user!.id, storeId });
  sendSuccess(res, { followed: Boolean(follow) });
});

export const followStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await resolveStore(req.params.storeId);
  if (!store) throw ApiError.notFound("Store not found");
  const storeId = store._id.toString();
  await StoreFollow.updateOne(
    { userId: req.user!.id, storeId },
    { $setOnInsert: { userId: req.user!.id, storeId } },
    { upsert: true },
  );
  sendSuccess(res, { followed: true });
});

export const unfollowStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await resolveStore(req.params.storeId);
  if (!store) throw ApiError.notFound("Store not found");
  await StoreFollow.deleteOne({ userId: req.user!.id, storeId: store._id.toString() });
  sendSuccess(res, { followed: false });
});
