import { Request, Response } from "express";
import { FlashSale, computeFlashSalePrice, isFlashSaleLive } from "./flashSale.model";
import { Product } from "../products/product.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** GET /flash-sales/active - public, currently running sales with live product pricing. */
export const listActiveFlashSales = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const sales = await FlashSale.find({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } }).sort({
    endsAt: 1,
  });

  const enriched = await Promise.all(
    sales.map(async (sale) => {
      const productIds = sale.productLimit ? sale.productIds.slice(0, sale.productLimit) : sale.productIds;
      const products = await Product.find({ _id: { $in: productIds }, isDeleted: false, status: "approved" });
      return {
        ...sale.toJSON(),
        remainingMs: sale.endsAt.getTime() - now.getTime(),
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          salePrice: computeFlashSalePrice(sale, p.discountPrice ?? p.price),
          images: p.images,
          stock: p.stock,
        })),
      };
    })
  );

  sendSuccess(res, enriched);
});

/** GET /flash-sales - seller sees own, admin sees all. */
export const listFlashSales = asyncHandler(async (req: Request, res: Response) => {
  const filter = req.user!.role === "admin" ? {} : { createdBy: req.user!.id };
  const sales = await FlashSale.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, sales);
});

/** POST /flash-sales - seller/admin creates a flash sale over their own products. */
export const createFlashSale = asyncHandler(async (req: Request, res: Response) => {
  const { productIds } = req.body as { productIds: string[] };

  if (req.user!.role === "seller") {
    const owned = await Product.countDocuments({ _id: { $in: productIds }, sellerId: req.user!.id });
    if (owned !== productIds.length) {
      throw ApiError.forbidden("You can only add your own products to a flash sale");
    }
  }

  const sale = await FlashSale.create({ ...req.body, createdBy: req.user!.id });
  sendSuccess(res, sale.toJSON(), "Flash sale created", 201);
});

/** DELETE /flash-sales/:id */
export const deleteFlashSale = asyncHandler(async (req: Request, res: Response) => {
  const sale = await FlashSale.findById(req.params.id);
  if (!sale) throw ApiError.notFound("Flash sale not found");
  if (req.user!.role !== "admin" && sale.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this flash sale");
  }
  await sale.deleteOne();
  sendSuccess(res, { success: true }, "Flash sale deleted");
});

/** Exported for reuse (e.g. cart pricing) without importing the model directly. */
export { isFlashSaleLive };
