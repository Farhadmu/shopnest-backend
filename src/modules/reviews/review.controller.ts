import { Request, Response } from "express";
import { Review } from "./review.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Helper: Recalculates the average rating and review count for a product
 * and writes the updated values to the Product document.
 */
async function recalcProductRating(productId: string) {
  const stats = await Review.aggregate([
    { $match: { productId } },
    { $group: { _id: "$productId", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  const avg = stats[0]?.avg ?? 0;
  const count = stats[0]?.count ?? 0;

  await Product.findByIdAndUpdate(productId, {
    ratingAvg: Math.round(avg * 10) / 10,
    ratingCount: count,
  });
}

/**
 * Controller: List Reviews For A Specific Product
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Target product ID
 * 2. Database Operation:
 *    - Review.find({ productId }).sort({ createdAt: -1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of reviews (Review[])
 */
export const listProductReviews = asyncHandler(async (req: Request, res: Response) => {
  const reviews = await Review.find({ productId: req.params.id }).sort({ createdAt: -1 });
  res.status(200).json(reviews);
});

/**
 * Controller: Add Review For A Product
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Target product ID
 *    - req.user: Logged-in user information (id, name)
 *    - req.body: rating (1-5), comment, images (optional)
 * 2. Database Operation:
 *    - Product.findOne to verify existence
 *    - Review.findOne to ensure user hasn't already reviewed this product
 *    - Order.findOne to check if the user actually bought the item (verified purchase)
 *    - Review.create(...) to save the review
 *    - Calls recalcProductRating(productId)
 * 3. Response Sent:
 *    - HTTP 201: Created review JSON object with message "Review submitted"
 */
export const addProductReview = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params.id;
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) throw ApiError.notFound("Product not found");

  const alreadyReviewed = await Review.findOne({ productId, userId: req.user!.id });
  if (alreadyReviewed) throw ApiError.conflict("You have already reviewed this product");

  const verifiedPurchase = Boolean(
    await Order.findOne({
      userId: req.user!.id,
      "items.productId": productId,
      status: { $in: ["delivered", "shipped", "out_for_delivery", "confirmed", "processing"] },
    })
  );

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

/**
 * Controller: Delete Review (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Review ID
 * 2. Database Operation:
 *    - Review.findByIdAndDelete(id)
 *    - Recalculates product rating with recalcProductRating
 * 3. Response Sent:
 *    - HTTP 200: { success: true } with "Review removed" message
 */
export const deleteReview = asyncHandler(async (req: Request, res: Response) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) throw ApiError.notFound("Review not found");

  await recalcProductRating(review.productId);
  sendSuccess(res, { success: true }, "Review removed");
});

/**
 * Controller: List All Reviews For Moderation (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.query.reported: Optional filter ("true") to only show reported reviews
 * 2. Database Operation:
 *    - Review.find(filter).sort({ createdAt: -1 }).limit(200)
 * 3. Response Sent:
 *    - HTTP 200: Raw array of reviews for moderation
 */
export const listAllReviewsForModeration = asyncHandler(async (req: Request, res: Response) => {
  const { reported } = req.query as { reported?: string };
  const filter = reported === "true" ? { reported: true } : {};
  const reviews = await Review.find(filter).sort({ createdAt: -1 }).limit(200);
  res.status(200).json(reviews);
});
