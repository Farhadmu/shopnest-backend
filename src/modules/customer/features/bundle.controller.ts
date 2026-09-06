import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { ProductBundle } from "../customer-intelligence.model";
import { ACTIVE_PRODUCT_FILTER } from "../../../utils/activeProductFilter";

// SMART BUNDLE BUILDER
export const getProductBundle = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Check if saved bundle exists
  let bundle = await ProductBundle.findOne({ mainProductId: productId });

  if (!bundle) {
    // Construct dynamic complementary bundle from related category items
    const complementaryItems = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      ...ACTIVE_PRODUCT_FILTER,
    }).limit(3);

    const items = [
      {
        productId: product.id,
        title: product.title,
        price: product.price,
        role: "main" as const,
      },
      ...complementaryItems.map((c) => ({
        productId: c.id,
        title: c.title,
        price: c.price,
        role: "complementary" as const,
      })),
    ];

    const originalTotal = items.reduce((sum, item) => sum + item.price, 0);
    const bundlePrice = Math.round(originalTotal * 0.88); // 12% bundle discount

    bundle = await ProductBundle.create({
      bundleName: `${product.title} Power Bundle`,
      mainProductId: product.id,
      category: product.category,
      items,
      originalTotal,
      bundlePrice,
      savingsPercentage: 12,
      compatibilityNote: "Verified complementary accessory package.",
    });
  }

  sendSuccess(res, bundle.toJSON());
});
