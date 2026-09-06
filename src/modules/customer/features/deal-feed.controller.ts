import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { ShoppingJourney } from "../customer-intelligence.model";

export const getPersonalizedDealFeed = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  let preferredCategories: string[] = [];

  if (userId) {
    const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });
    if (journey?.category) preferredCategories.push(journey.category);
    const wishlist = await Wishlist.findOne({ userId });
    if (wishlist?.items.length) {
      const wishProductIds = wishlist.items.map((i) => i.productId);
      const wishProducts = await Product.find({ _id: { $in: wishProductIds } });
      preferredCategories.push(...wishProducts.map((p) => p.category));
    }
  }

  const query: any = {
    isDeleted: { $ne: true },
    discountPrice: { $exists: true, $gt: 0 },
  };

  if (preferredCategories.length > 0) {
    query.category = { $in: [...new Set(preferredCategories)] };
  }

  let deals = await Product.find(query).sort({ sold: -1, ratingAvg: -1 }).limit(16);
  if (deals.length < 6) {
    deals = await Product.find({ isDeleted: { $ne: true }, discountPrice: { $exists: true, $gt: 0 } })
      .sort({ sold: -1 })
      .limit(16);
  }

  sendSuccess(res, {
    matchedPreferences: preferredCategories,
    deals,
  });
});

// ============================================================
// 11. RECENTLY COMPARED PRODUCTS (Feature 23)
// ============================================================
