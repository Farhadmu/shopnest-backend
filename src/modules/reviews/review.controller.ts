import { Request, Response } from "express";
import { Review } from "./review.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

async function recalcProductRating(productId: string) {
  const stats = await Review.aggregate([
    { $match: { productId } },
    { $group: { _id: "$productId", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const avg = stats[0]?.avg ?? 0;
  const count = stats[0]?.count ?? 0;
  await Product.findByIdAndUpdate(productId, { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count });
}

export const listProductReviews = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await Review.find({ productId: req.params.id }).sort({ createdAt: -1 });
  res.status(200).json(reviews);
});

export const addProductReview = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params.id;
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  const alreadyReviewed = await Review.findOne({ productId, userId: req.user!.id });
  if (alreadyReviewed) throw ApiError.conflict("You have already reviewed this product");

  const verifiedPurchase = !!(await Order.findOne({
    userId: req.user!.id,
    "items.productId": productId,
    status: { $in: ["delivered", "shipped", "out_for_delivery", "confirmed", "processing"] },
  }));

  const review = await Review.create({
    productId,
    userId: req.user!.id,
    userName: req.user!.name,
    rating: req.body.rating,
    comment: req.body.comment,
    images: req.body.images ?? [],
    verifiedPurchase,
  });

  await recalcProductRating(productId);

  sendSuccess(res, review.toJSON(), "Review submitted", 201);
});

export const deleteReview = asyncHandler(async (req: Request, res: Response) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) throw ApiError.notFound("Review not found");
  await recalcProductRating(review.productId);
  sendSuccess(res, { success: true }, "Review removed");
});

export const listAllReviewsForModeration = asyncHandler(async (req: Request, res: Response) => {
  const { reported } = req.query as { reported?: string };
  const filter = reported === "true" ? { reported: true } : {};
  const reviews = await Review.find(filter).sort({ createdAt: -1 }).limit(200);
  res.status(200).json(reviews);
});
