import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Wishlist } from "../../wishlist/wishlist.model";

// 12. WISHLIST ANALYTICS & PRICE-DROP OPPORTUNITIES
export const getWishlistAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  const wishlist = await Wishlist.findOne({ userId });
  const productIds = (wishlist?.items || []).map((i) => i.productId);

  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });

  const items = products.map((p) => {
    const originalPrice = p.price;
    const currentPrice = p.discountPrice || p.price;
    const hasDiscount = originalPrice > currentPrice;
    const priceDrop = hasDiscount ? originalPrice - currentPrice : 0;
    const priceDropPercent = hasDiscount && originalPrice > 0 ? Math.round((priceDrop / originalPrice) * 100) : 0;

    return {
      id: p.id,
      title: p.title,
      currentPrice,
      originalPrice,
      hasDiscount,
      priceDrop,
      priceDropPercent,
      category: p.category,
      images: p.images || [],
      ratingAvg: p.ratingAvg || 0,
      stock: p.stock,
      viewsCount: p.views || (p as any).viewsCount || 0,
    };
  });

  const priceDropOpportunities = items.filter((i) => i.hasDiscount);
  const totalPotentialSavings = items.reduce((sum, i) => sum + i.priceDrop, 0);

  sendSuccess(res, {
    totalWishlistCount: items.length,
    totalPotentialSavings,
    items,
    priceDropOpportunities,
  });
});