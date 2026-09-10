import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { ACTIVE_PRODUCT_FILTER } from "../../../utils/activeProductFilter";
import { resolveCategoryNames } from "../../../utils/category.utils";

// SMART BUDGET PLANNER
export const generateBudgetPlan = asyncHandler(async (req: Request, res: Response) => {
  const { budget, purpose } = req.body;
  const targetBudget = Number(budget);

  if (!Number.isFinite(targetBudget) || targetBudget <= 0) {
    throw ApiError.badRequest("Please provide a valid budget amount");
  }
  if (!purpose) {
    throw ApiError.badRequest("Please select a category");
  }

  // Fetch approved, in-stock products for the category
  // (resolves slug/name -> actual category names + subcategories, same as product listing)
  const categoryNames = await resolveCategoryNames(purpose);
  const categoryProducts = await Product.find({
    ...ACTIVE_PRODUCT_FILTER,
    stock: { $gt: 0 },
    category: { $in: categoryNames.map((n) => new RegExp(`^${n}$`, "i")) },
  });

  if (categoryProducts.length === 0) {
    return sendSuccess(res, {
      targetBudget,
      totalPlannedSpend: 0,
      remainingBudget: targetBudget,
      purpose,
      items: [],
      planSummary: "No available products found in this category to build a plan yet.",
    });
  }

  // Filter products that actually fit inside the user's budget
  const affordableProducts = categoryProducts
    .filter((p) => p.price <= targetBudget)
    .sort((a, b) => a.price - b.price);

  // If the cheapest item in the category exceeds targetBudget
  if (affordableProducts.length === 0) {
    const minPrice = Math.min(...categoryProducts.map((p) => p.price));
    return sendSuccess(res, {
      targetBudget,
      totalPlannedSpend: 0,
      remainingBudget: targetBudget,
      purpose,
      items: [],
      planSummary: `The minimum price in the '${purpose}' category is ৳${minPrice.toLocaleString()}. Please increase your budget.`,
    });
  }

  const plannedItems: Array<{
    role: string;
    allocatedBudget: number;
    selectedProduct?: { id: string; title: string; price: number; category: string; image: string };
    alternatives: Array<{ id: string; title: string; price: number; type: "cheaper" | "premium" }>;
  }> = [];

  const usedIds = new Set<string>();
  let currentRemaining = targetBudget;
  let totalPlannedSpend = 0;

  const pushItem = (
    role: string,
    product: (typeof categoryProducts)[number],
    allocatedBudget: number
  ) => {
    const pool = categoryProducts.filter((p) => p.id !== product.id && p.stock > 0);
    const cheaper = pool.filter((p) => p.price < product.price).sort((a, b) => b.price - a.price).slice(0, 2);
    const premium = pool.filter((p) => p.price > product.price).sort((a, b) => a.price - b.price).slice(0, 2);

    plannedItems.push({
      role,
      allocatedBudget: product.price,
      selectedProduct: {
        id: product.id,
        title: product.title,
        price: product.price,
        category: product.category,
        image: product.images?.[0] || "",
      },
      alternatives: [
        ...cheaper.map((p) => ({ id: p.id, title: p.title, price: p.price, type: "cheaper" as const })),
        ...premium.map((p) => ({ id: p.id, title: p.title, price: p.price, type: "premium" as const })),
      ],
    });
  };

  // Build optimal allocation within budget limit
  const maxItems = Math.min(3, affordableProducts.length);

  for (let i = 0; i < maxItems; i++) {
    const slotBudget = currentRemaining / (maxItems - i);

    // Pick best matching product that strictly costs <= currentRemaining
    const pick = affordableProducts
      .filter((p) => !usedIds.has(p.id) && p.price <= currentRemaining)
      .sort((a, b) => Math.abs(a.price - slotBudget) - Math.abs(b.price - slotBudget))[0];

    if (!pick) break;

    usedIds.add(pick.id);
    const role = i === 0 ? "Primary Value Pick" : `Complementary Pick ${i}`;
    pushItem(role, pick, slotBudget);

    totalPlannedSpend += pick.price;
    currentRemaining -= pick.price;
  }

  const remainingBudget = Math.max(0, targetBudget - totalPlannedSpend);

  return sendSuccess(res, {
    targetBudget,
    totalPlannedSpend,
    remainingBudget,
    purpose,
    items: plannedItems,
    planSummary: `Allocated ${plannedItems.length} curated pick(s) within your ৳${targetBudget.toLocaleString()} budget with ৳${remainingBudget.toLocaleString()} remaining buffer.`,
  });
});