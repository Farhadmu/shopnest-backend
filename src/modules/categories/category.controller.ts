import { Request, Response } from "express";
import { Category } from "./category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Helper: Converts any string into a URL-friendly slug.
 * Example: "Smart Phones & Tablets" -> "smart-phones-tablets"
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Helper: Validates that assigning a parent category doesn't create a circular dependency loop.
 */
async function wouldCreateCycle(id: string, candidateParentId: string): Promise<boolean> {
  if (candidateParentId === id) return true;

  let current = await Category.findById(candidateParentId).select("parent").lean();
  const seen = new Set<string>([id]);

  while (current?.parent) {
    const parentId = String(current.parent);
    if (seen.has(parentId)) return true;
    if (parentId === id) return true;
    seen.add(parentId);
    current = await Category.findById(parentId).select("parent").lean();
  }
  return false;
}

/**
 * Controller: List All Categories
 *
 * 1. Inputs Extracted:
 *    - None (public endpoint)
 * 2. Database Operation:
 *    - Category.find().sort({ name: 1 })
 * 3. Response Sent:
 *    - HTTP 200: Raw array of Category objects (Category[])
 */
export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await Category.find().sort({ name: 1 });
  res.status(200).json(categories);
});

/**
 * Controller: Get Single Category By ID
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Category ID
 * 2. Database Operation:
 *    - Category.findById(id)
 * 3. Response Sent:
 *    - HTTP 200: Single Category JSON object
 */
export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, category.toJSON());
});

/**
 * Controller: Create New Category (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.body: name, slug (optional), parent (optional), image (optional)
 * 2. Database Operation:
 *    - Category.findOne({ slug }) to ensure uniqueness
 *    - Category.findById(parent) to verify parent exists if specified
 *    - Category.create(...) to save the new category
 * 3. Response Sent:
 *    - HTTP 201: Created Category JSON object with message "Category created"
 */
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const { name, parent, image } = req.body;
  const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);

  const exists = await Category.findOne({ slug });
  if (exists) throw ApiError.conflict("A category with this slug already exists");

  if (parent) {
    const parentCategory = await Category.findById(parent);
    if (!parentCategory) throw ApiError.badRequest("Selected parent category does not exist");
  }

  const category = await Category.create({ name, slug, parent: parent || null, image: image || null });
  sendSuccess(res, category.toJSON(), "Category created", 201);
});

/**
 * Controller: Update Category (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Category ID to update
 *    - req.body: name, slug, parent, image
 * 2. Database Operation:
 *    - Category.findByIdAndUpdate(id, update, { new: true })
 * 3. Response Sent:
 *    - HTTP 200: Updated Category JSON object with message "Category updated"
 */
export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const update = { ...req.body };
  const id = req.params.id;

  const existing = await Category.findById(id);
  if (!existing) throw ApiError.notFound("Category not found");

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

/**
 * Controller: Delete Category (Admin Only)
 *
 * 1. Inputs Extracted:
 *    - req.params.id: Category ID to delete
 * 2. Database Operation:
 *    - Category.countDocuments({ parent: id }) to prevent deleting parents of active children
 *    - Category.findByIdAndDelete(id)
 * 3. Response Sent:
 *    - HTTP 200: { success: true } with message "Category deleted"
 */
export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const childCount = await Category.countDocuments({ parent: req.params.id });
  if (childCount > 0) {
    throw ApiError.conflict(
      `Cannot delete: ${childCount === 1 ? "1 subcategor" : `${childCount} subcategor`}y still point to this category. Reassign or delete them first.`
    );
  }

  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, { success: true }, "Category deleted");
});