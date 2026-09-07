import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";

export const searchBanglaBanglish = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  if (!q || !q.trim()) {
    return sendSuccess(res, { products: [], extractedIntent: null });
  }

  let normalized = q.toLowerCase().trim();
  // Transliterate Bangla digits to English
  const bnToEnMap: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };
  normalized = normalized.replace(/[০-৯]/g, (digit) => bnToEnMap[digit] || digit);

  // Extract Budget: e.g. "3000 takar moddhe", "50000 er niche", "under 20000", "5000 tk"
  let maxBudget: number | null = null;
  const budgetMatch = normalized.match(/(\d+)\s*(?:taka|takar|tk|টাকা|টাকার|৳)?\s*(?:moddhe|er moddhe|niche|under|below|max|porjonto|পর্যন্ত)?/i);
  if (budgetMatch && budgetMatch[1]) {
    const parsed = parseInt(budgetMatch[1], 10);
    if (!isNaN(parsed) && parsed > 50) {
      maxBudget = parsed;
    }
  }

  // Common Banglish synonyms mapping
  const categoryKeywords: Record<string, string[]> = {
    Electronics: ["phone", "mobile", "laptop", "headphone", "earphone", "keyboard", "mouse", "charger", "gadget", "computar", "komputer", "soundbox"],
    Fashion: ["shirt", "tshirt", "pant", "jama", "sharee", "shari", "shoes", "shoe", "juta", "panjabi", "bag", "watch", "ghori"],
    "Home & Living": ["light", "fan", "chair", "table", "bed", "furniture", "blender", "kitchen"],
    Beauty: ["cream", "lotion", "perfume", "facewash", "makeup", "shampoo", "oil"],
    Sports: ["cycle", "football", "cricket", "bat", "ball", "gym", "jersey"],
  };

  let detectedCategory: string | null = null;
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => normalized.includes(w))) {
      detectedCategory = cat;
      break;
    }
  }

  // Clean keywords
  const stopwords = ["taka", "takar", "tk", "moddhe", "er", "valo", "bhalo", "dorkar", "chai", "lagbe", "best", "under", "within", "er moddhe"];
  const cleanTokens = normalized
    .split(/\s+/)
    .filter((token) => !stopwords.includes(token) && isNaN(Number(token)));

  const queryFilter: any = { isDeleted: { $ne: true } };

  if (maxBudget) {
    queryFilter.price = { $lte: maxBudget };
  }

  if (detectedCategory) {
    queryFilter.category = new RegExp(detectedCategory, "i");
  }

  if (cleanTokens.length > 0) {
    const searchRegex = new RegExp(cleanTokens.join("|"), "i");
    queryFilter.$or = [
      { title: searchRegex },
      { description: searchRegex },
      { category: searchRegex },
      { tags: searchRegex },
    ];
  }

  const products = await Product.find(queryFilter)
    .sort({ ratingAvg: -1, sold: -1 })
    .limit(24);

  sendSuccess(res, {
    query: q,
    extractedIntent: {
      budgetLimit: maxBudget,
      detectedCategory,
      keywords: cleanTokens,
    },
    totalFound: products.length,
    products,
  });
});

// ============================================================
// 3. PRODUCT TRUST REPORT (Feature 5 & 7)
// ============================================================
