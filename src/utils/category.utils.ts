import { Category } from "../modules/categories/category.model";

/**
 * Resolves a category name or slug to itself plus all subcategory names.
 * For example, resolving "Electronics" will also return "Phones" and "Laptops".
 */
export async function resolveCategoryNames(categoryNameOrSlug: string): Promise<string[]> {
  const root = await Category.findOne({
    $or: [
      { name: { $regex: `^${categoryNameOrSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { slug: categoryNameOrSlug.toLowerCase() },
    ],
  })
    .select("_id name")
    .lean();

  if (!root) return [categoryNameOrSlug];

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

  return names;
}