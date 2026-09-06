import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { SavedSearch } from "../customer-extras.model";

// 13. SAVED SEARCHES
export const getSavedSearches = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const searches = await SavedSearch.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, searches);
});

export const createSavedSearch = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const { query, category, minPrice, maxPrice, sort } = req.body;

  if (!query) throw ApiError.badRequest("Search query is required");

  // Count matching products
  const filter: Record<string, unknown> = { isDeleted: false, status: "approved" };
  if (category) filter.category = category;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) (filter.price as any).$gte = Number(minPrice);
    if (maxPrice) (filter.price as any).$lte = Number(maxPrice);
  }
  const resultCount = await Product.countDocuments(filter);

  const search = await SavedSearch.create({
    userId,
    query,
    category,
    minPrice,
    maxPrice,
    sort,
    resultCount,
  });

  sendSuccess(res, search, "Search saved successfully", 201);
});

export const deleteSavedSearch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id || "demo-user";

  const search = await SavedSearch.findOneAndDelete({ _id: id, userId });
  if (!search) throw ApiError.notFound("Saved search not found");

  sendSuccess(res, { id }, "Saved search removed");
});