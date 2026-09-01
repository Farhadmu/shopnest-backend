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

/** Walks the parent chain to make sure `candidateParentId` is not `id` itself
 * or one of its own descendants — otherwise saving would create a loop. */
async function wouldCreateCycle(id: string, candidateParentId: string): Promise<boolean> {
  if (candidateParentId === id) return true;

  let current = await Category.findById(candidateParentId).select("parent").lean();
  const seen = new Set<string>([id]);

  while (current?.parent) {
    const parentId = String(current.parent);
    if (seen.has(parentId)) return true; // already-broken chain, treat as cycle
    if (parentId === id) return true;
    seen.add(parentId);
    current = await Category.findById(parentId).select("parent").lean();
  }
  return false;
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

  if (parent) {
    const parentCategory = await Category.findById(parent);
    if (!parentCategory) throw ApiError.badRequest("Selected parent category does not exist");
  }

  const category = await Category.create({ name, slug, parent: parent || null, image });
  sendSuccess(res, category.toJSON(), "Category created", 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const update = { ...req.body };
  const id = req.params.id;

  if (update.slug) {
    update.slug = slugify(update.slug);
    const slugOwner = await Category.findOne({ slug: update.slug });
    if (slugOwner && String(slugOwner._id) !== id) {
      throw ApiError.conflict("A category with this slug already exists");
    }
  }

  if (update.parent) {
    const parentCategory = await Category.findById(update.parent);
    if (!parentCategory) throw ApiError.badRequest("Selected parent category does not exist");
    if (await wouldCreateCycle(id, String(update.parent))) {
      throw ApiError.badRequest("A category cannot be its own parent or descendant");
    }
  }

  const category = await Category.findByIdAndUpdate(id, update, { new: true });
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, category.toJSON(), "Category updated");
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const childCount = await Category.countDocuments({ parent: req.params.id });
  if (childCount > 0) {
    throw ApiError.conflict(
      `Cannot delete: ${childCount} subcategor${childCount === 1 ? "y" : "ies"} still point to this category. Reassign or delete them first.`
    );
  }

  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, { success: true }, "Category deleted");
});