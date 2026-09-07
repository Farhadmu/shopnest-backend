import { Request, Response } from "express";
import mongoose from "mongoose";
import { HeroBanner } from "./hero-banner.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Category } from "../categories/category.model";
import type { RequestHandler } from "express";

export const listHeroBanners = asyncHandler(async (req: Request, res: Response) => {
  const categoryId = req.query.category_id as string | undefined;
  const placement = req.query.placement as string | undefined;
  const isAdmin = req.user?.role === "admin";

  const filter: Record<string, unknown> = {};
  if (categoryId) {
    const objectId = new mongoose.Types.ObjectId(categoryId);
    filter.categoryId = objectId;
  } else {
    filter.categoryId = null;
  }

  if (!isAdmin) {
    filter.isActive = true;
  }
  if (placement) filter.placement = placement;

  const banners = await HeroBanner.find(filter)
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  res.status(200).json(banners);
});

export const getHeroBannerById = asyncHandler(async (req: Request, res: Response) => {
  const banner = await HeroBanner.findById(req.params.id).lean();
  if (!banner) throw ApiError.notFound("Hero banner not found");
  sendSuccess(res, banner);
});

export const createHeroBanner = asyncHandler(async (req: Request, res: Response) => {
  const {
    categoryId, imageUrl, placement, eyebrow, title, highlight, subtitle,
    description, price, buttonText, targetUrl, bgClassName, textTheme,
    isActive, displayOrder,
  } = req.body;

  const data: Record<string, unknown> = {
    imageUrl,
    placement: placement ?? "hero",
    eyebrow: eyebrow ?? null,
    title: title ?? null,
    highlight: highlight ?? null,
    subtitle: subtitle ?? null,
    description: description ?? null,
    price: price ?? null,
    buttonText: buttonText ?? null,
    targetUrl: targetUrl ?? null,
    bgClassName: bgClassName ?? null,
    textTheme: textTheme ?? "light",
    isActive: isActive ?? true,
    displayOrder: displayOrder ?? 0,
  };

  if (categoryId) {
    const category = await Category.findById(categoryId).select("_id").lean();
    if (!category) throw ApiError.badRequest("Selected category does not exist");
    data.categoryId = new mongoose.Types.ObjectId(categoryId);
  } else {
    data.categoryId = null;
  }

  if (data.placement === "side" || data.placement === "bottom") {
    const existingCount = await HeroBanner.countDocuments({
      categoryId: data.categoryId,
      placement: data.placement,
    });
    if (existingCount >= 2) {
      throw ApiError.badRequest(`A category can have at most two ${data.placement} cards`);
    }
  }

  const banner = await HeroBanner.create(data);
  sendSuccess(res, banner.toJSON(), "Hero banner created", 201);
});

export const updateHeroBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await HeroBanner.findById(req.params.id);
  if (!banner) throw ApiError.notFound("Hero banner not found");

  const update: Record<string, unknown> = { ...req.body };

  if (update.categoryId !== undefined) {
    if (update.categoryId) {
      const category = await Category.findById(String(update.categoryId)).select("_id").lean();
      if (!category) throw ApiError.badRequest("Selected category does not exist");
      update.categoryId = new mongoose.Types.ObjectId(String(update.categoryId));
    } else {
      update.categoryId = null;
    }
  }

  if (update.displayOrder !== undefined) {
    update.displayOrder = Number(update.displayOrder);
  }

  const targetPlacement = String(update.placement ?? banner.placement);
  const targetCategoryId = update.categoryId !== undefined ? update.categoryId : banner.categoryId;
  if (targetPlacement === "side" || targetPlacement === "bottom") {
    const existingCount = await HeroBanner.countDocuments({
      categoryId: targetCategoryId,
      placement: targetPlacement,
      _id: { $ne: banner._id },
    });
    if (existingCount >= 2) {
      throw ApiError.badRequest(`A category can have at most two ${targetPlacement} cards`);
    }
  }

  Object.assign(banner, update);
  await banner.save();

  sendSuccess(res, banner.toJSON(), "Hero banner updated");
});

export const uploadHeroBannerImage: RequestHandler = (req, res) => {
  const file = req.file;
  if (!file) throw ApiError.badRequest("An image file is required");
  sendSuccess(res, { imageUrl: `/uploads/hero-banners/${file.filename}` }, "Hero banner image uploaded", 201);
};

export const deleteHeroBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await HeroBanner.findByIdAndDelete(req.params.id);
  if (!banner) throw ApiError.notFound("Hero banner not found");
  sendSuccess(res, { success: true }, "Hero banner deleted");
});

export const reorderHeroBanners = asyncHandler(async (req: Request, res: Response) => {
  const { bannerIds } = req.body as { bannerIds: string[] };

  if (!Array.isArray(bannerIds) || bannerIds.length === 0) {
    throw ApiError.badRequest("bannerIds must be a non-empty array");
  }

  const updates = bannerIds.map((id, index) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(id) },
      update: { $set: { displayOrder: index + 1 } },
    },
  }));

  await HeroBanner.bulkWrite(updates);

  const updated = await HeroBanner.find({ _id: { $in: bannerIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .sort({ displayOrder: 1 })
    .lean();

  sendSuccess(res, updated, "Banner order updated");
});
