import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { CustomerActivity } from "../customer-extras.model";
import { WishlistGroup } from "../customer-extras.model";

export const getSmartWishlist = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) return sendSuccess(res, { items: [], priceDrops: [], stockAlerts: [] });

  const productIds = wishlist.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });

  const items = products.map((p) => {
    const currentPrice = p.discountPrice || p.price;
    const priceDrop = p.price > currentPrice ? p.price - currentPrice : 0;
    return {
      id: p.id, title: p.title, currentPrice, originalPrice: p.price, priceDrop,
      priceDropPercent: priceDrop > 0 ? Math.round((priceDrop / p.price) * 100) : 0,
      hasPriceDrop: priceDrop > 0, inStock: p.stock > 0, stock: p.stock,
      category: p.category, images: p.images || [], ratingAvg: p.ratingAvg,
      addedAt: wishlist.items.find((i) => i.productId === p.id)?.addedAt,
    };
  });

  sendSuccess(res, { items, priceDrops: items.filter((i) => i.hasPriceDrop), stockAlerts: items.filter((i) => !i.inStock), totalItems: items.length });
});

export const togglePriceTracking = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await CustomerActivity.create({ userId, activityType: "wishlist_add", title: "Price tracking toggled", details: `Product ${req.params.productId}` });
  sendSuccess(res, { success: true, message: "Price tracking updated" });
});

// ============================================================
// SMART BUY AGAIN (Feature 18)
// ============================================================

export const getWishlistGroups = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const groups = await WishlistGroup.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, groups);
});

export const createWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, description, icon, color, productIds } = req.body;

  const group = await WishlistGroup.create({
    userId,
    name,
    description: description || "",
    icon: icon || "❤️",
    color: color || "#6366f1",
    productIds: productIds || [],
  });

  sendSuccess(res, group, "Wishlist group created!");
});

export const updateWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const group = await WishlistGroup.findOneAndUpdate(
    { _id: id, userId: req.user!.id },
    { $set: req.body },
    { new: true }
  );
  if (!group) throw ApiError.notFound("Group not found");
  sendSuccess(res, group, "Wishlist group updated!");
});

export const deleteWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await WishlistGroup.findOneAndDelete({ _id: id, userId: req.user!.id });
  sendSuccess(res, { success: true }, "Wishlist group deleted");
});

// ============================================================
// 15. DELIVERY EXPERIENCE FEEDBACK (Feature 28)
// ============================================================
