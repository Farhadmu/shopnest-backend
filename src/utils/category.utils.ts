import { Category } from "../modules/categories/category.model";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string[]; expiresAt: number }>();

export function invalidateCategoryCache(): void {
  cache.clear();
}

async function resolveSingleCategoryNames(categoryNameOrSlug: string): Promise<string[]> {
  const cached = cache.get(categoryNameOrSlug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const cleanSlug = categoryNameOrSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const root = await Category.findOne({
    $or: [
      { name: { $regex: `^${categoryNameOrSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { slug: categoryNameOrSlug.toLowerCase() },
      { slug: cleanSlug },
    ],
  })
    .select("_id name")
    .lean();

  if (!root) {
    cache.set(categoryNameOrSlug, { value: [categoryNameOrSlug], expiresAt: Date.now() + CACHE_TTL_MS });
    return [categoryNameOrSlug];
  }

  const allCategories = await Category.find().select("_id name parent").lean();
  const byParent = new Map<string, { _id: unknown; name: string }[]>();

  allCategories.forEach((c) => {
    const parentId = c.parent ? String(c.parent) : "";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(c);
  });

  const names = [root.name];
  const queue = [String(root._id)];

  while (queue.length) {
    const id = queue.shift()!;
    const children = byParent.get(id) || [];
    for (const child of children) {
      names.push(child.name);
      queue.push(String(child._id));
    }
  }

  cache.set(categoryNameOrSlug, { value: names, expiresAt: Date.now() + CACHE_TTL_MS });
  return names;
}

export async function resolveCategoryNames(categoryInput?: string | string[]): Promise<string[]> {
  if (!categoryInput) return [];
  const rawList = Array.isArray(categoryInput) ? categoryInput : [categoryInput];
  const parts = rawList
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return [];

  const results = await Promise.all(parts.map((p) => resolveSingleCategoryNames(p)));
  return Array.from(new Set(results.flat()));
}
