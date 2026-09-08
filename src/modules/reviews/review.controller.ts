import { Request, Response } from "express";
import { Review } from "./review.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import mongoose from "mongoose";

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

export const getReviewStats = asyncHandler(async (_req: Request, res: Response) => {
  const [
    totalReviews,
    avgRatingAgg,
    verifiedReviews,
    reportedReviews,
    ratingDistribution,
  ] = await Promise.all([
    Review.countDocuments({}),
    Review.aggregate([
      { $group: { _id: null, avg: { $avg: "$rating" } } },
    ]),
    Review.countDocuments({ verifiedPurchase: true }),
    Review.countDocuments({ reported: true }),
    Review.aggregate([
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]),
  ]);

  const avgRating = avgRatingAgg[0]?.avg ?? 0;

  const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of ratingDistribution) {
    distribution[r._id as number] = r.count;
  }

  sendSuccess(res, {
    totalReviews,
    avgRating: Math.round(avgRating * 10) / 10,
    verifiedReviews,
    reportedReviews,
    distribution,
  });
});

export const searchAdminReviews = asyncHandler(async (req: Request, res: Response) => {
  const {
    q,
    reported,
    verified,
    rating,
    productId,
    userId,
    sortBy = "createdAt",
    sortDir = "-1",
    page = "1",
    limit = "20",
  } = req.query as {
    q?: string;
    reported?: string;
    verified?: string;
    rating?: string;
    productId?: string;
    userId?: string;
    sortBy?: string;
    sortDir?: string;
    page?: string;
    limit?: string;
  };

  const filter: Record<string, unknown> = {};

  if (reported === "true") filter.reported = true;
  if (reported === "false") filter.reported = false;
  if (verified === "true") filter.verifiedPurchase = true;
  if (verified === "false") filter.verifiedPurchase = false;
  if (rating) filter.rating = Number(rating);
  if (productId) filter.productId = productId;
  if (userId) filter.userId = userId;

  if (q) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { comment: regex },
      { userName: regex },
      { productId: regex },
      { userId: regex },
    ];
  }

  const sortField = ["createdAt", "updatedAt", "rating", "helpfulCount"].includes(sortBy) ? sortBy : "createdAt";
  const sortOrder = sortDir === "1" ? 1 : -1;

  const skip = (Number(page) - 1) * Number(limit);

  const [reviews, total] = await Promise.all([
    Review.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(Number(limit)),
    Review.countDocuments(filter),
  ]);

  sendSuccess(res, {
    reviews,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const dismissReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound("Review not found");

  review.reported = false;
  await review.save();

  sendSuccess(res, review.toJSON(), "Report dismissed");
});

export const hideReview = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound("Review not found");

  review.reported = true;
  await review.save();

  sendSuccess(res, review.toJSON(), "Review hidden");
});

export const removeReviewAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound("Review not found");

  const productId = review.productId;
  await Review.findByIdAndDelete(id);

  await recalcProductRating(productId);

  sendSuccess(res, { success: true }, "Review permanently removed");
});
