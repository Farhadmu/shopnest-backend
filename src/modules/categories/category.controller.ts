import { Request, Response } from "express";
import { Category } from "./category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await Category.find().sort({ name: 1 });
  res.status(200).json(categories);
});

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, category.toJSON());
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const { name, parent, image } = req.body;
  const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);

  const exists = await Category.findOne({ slug });
  if (exists) throw ApiError.conflict("A category with this slug already exists");

  const category = await Category.create({ name, slug, parent: parent || null, image });
  sendSuccess(res, category.toJSON(), "Category created", 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const update = { ...req.body };
  if (update.slug) update.slug = slugify(update.slug);

  const category = await Category.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, category.toJSON(), "Category updated");
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, { success: true }, "Category deleted");
});
