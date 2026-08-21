import { Request, Response } from "express";
import { Wishlist } from "./wishlist.model";
import { asyncHandler } from "../../utils/async-handler";

async function getOrCreate(userId: string) {
  let wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) wishlist = await Wishlist.create({ userId, items: [] });
  return wishlist;
}

export const getWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await getOrCreate(req.user!.id);
  res.status(200).json(wishlist.items);
});

export const addWishlistItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const wishlist = await getOrCreate(req.user!.id);

  if (!wishlist.items.some((i) => i.productId === productId)) {
    wishlist.items.push({ productId, addedAt: new Date() });
    await wishlist.save();
  }

  res.status(200).json(wishlist.items);
});

export const removeWishlistItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const wishlist = await getOrCreate(req.user!.id);
  wishlist.items = wishlist.items.filter((i) => i.productId !== productId);
  await wishlist.save();
  res.status(200).json(wishlist.items);
});
