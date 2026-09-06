import { Request, Response } from "express";
import { Wishlist } from "./wishlist.model";
import { asyncHandler } from "../../utils/async-handler";

/**
 * Helper: Retrieves the user's wishlist from MongoDB or initializes an empty one.
 */
async function getOrCreate(userId: string) {
  let wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) {
    wishlist = await Wishlist.create({ userId, items: [] });
  }
  return wishlist;
}

/**
 * Controller: Get Logged-In User's Wishlist
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 * 2. Database Operation:
 *    - Wishlist.findOne({ userId }) (or Wishlist.create if new)
 * 3. Response Sent:
 *    - HTTP 200: Raw array of wishlist items [{ productId, addedAt }]
 */
export const getWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await getOrCreate(req.user!.id);
  res.status(200).json(wishlist.items);
});

/**
 * Controller: Add Item to Wishlist
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 *    - req.body.productId: ID of the product to bookmark
 * 2. Database Operation:
 *    - Wishlist.findOne, checks for existing item, pushes new item if not present, wishlist.save()
 * 3. Response Sent:
 *    - HTTP 200: Updated array of wishlist items
 */
export const addWishlistItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.body as { productId: string };
  const wishlist = await getOrCreate(req.user!.id);

  if (!wishlist.items.some((i) => i.productId === productId)) {
    wishlist.items.push({ productId, addedAt: new Date() });
    await wishlist.save();
  }

  res.status(200).json(wishlist.items);
});

/**
 * Controller: Remove Item From Wishlist
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 *    - req.params.productId: ID of the product to remove
 * 2. Database Operation:
 *    - Wishlist.findOne, filters out target productId, wishlist.save()
 * 3. Response Sent:
 *    - HTTP 200: Updated array of wishlist items
 */
export const removeWishlistItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const wishlist = await getOrCreate(req.user!.id);

  wishlist.items = wishlist.items.filter((i) => i.productId !== productId);
  await wishlist.save();

  res.status(200).json(wishlist.items);
});
