import { cosineSimilarity, generateFeatureVector } from "./visual-embedding.service";

export interface VisualAnalysisUnderstanding {
  title: string;
  category: string;
  subcategory?: string;
  productType?: string;
  brand?: string;
  model?: string;
  marketPriceEstimate?: string;
  color?: string;
  colors?: string[];
  style?: string[];
  visualAttributes?: string[];
  features?: string[];
  keywords: string[];
  confidence: "high" | "medium" | "low";
}

export interface HybridRankedProduct {
  _id: string;
  title: string;
  description?: string;
  price: number;
  discountPrice?: number;
  category: string;
  images: string[];
  ratingAvg?: number;
  ratingCount?: number;
  stock?: number;
  sold?: number;
  sellerId?: any;
  matchScore: number;
  matchBadge: "Direct Match" | "Similar Style" | "Alternative";
  visualSimilarity: number;
  matchGroup: "HIGHLY SIMILAR" | "SIMILAR STYLE" | "ALTERNATIVE";
  breakdown: {
    visualSimilarity: number;
    productTypeMatch: boolean;
    categoryMatch: boolean;
    brandMatch: boolean;
    colorMatch: boolean;
    inStock: boolean;
  };
}

const GENERIC_ADJECTIVES = new Set([
  "wireless", "wired", "bluetooth", "smart", "digital", "portable", "mini",
  "pro", "premium", "ultra", "super", "new", "best", "top", "high", "low",
  "big", "small", "large", "medium", "heavy", "light", "thin", "slim",
  "fast", "quick", "modern", "classic", "multi", "dual", "single",
  "electric", "electronic", "automatic", "manual", "rechargeable",
  "adjustable", "foldable", "compact", "professional", "advanced",
  "true", "active", "passive", "noise", "cancelling", "canceling",
]);

const STOP_WORDS = new Set([
  "with", "and", "for", "the", "a", "an", "in", "of", "to", "by", "on", "set", "pack", "size", "edition", "case"
]);

/**
 * Extracts product type nouns (e.g. "earbuds", "headphones", "sneakers")
 */
/**
 * Extracts product type nouns (e.g. "earbuds", "headphones", "sneakers")
 */
export function extractTypeNouns(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/[\s,&/]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !GENERIC_ADJECTIVES.has(w));
}

export function stemWord(w: string): string {
  const low = w.toLowerCase();
  if (low.endsWith("ies") && low.length > 4) return low.slice(0, -3) + "y";
  if (low.endsWith("es") && low.length > 3 && !low.endsWith("ses") && !low.endsWith("zes")) return low.slice(0, -2);
  if (low.endsWith("s") && low.length > 2 && !low.endsWith("ss")) return low.slice(0, -1);
  return low;
}

export function matchNounInText(noun: string, text: string): boolean {
  if (!noun || !text) return false;
  const n = noun.toLowerCase();
  const stem = stemWord(n);
  return text.includes(n) || (stem.length > 2 && text.includes(stem));
}

/**
 * Executes hybrid ranking combining vector cosine similarity with multi-field catalog relevance
 */
export function rankProductsHybrid(
  candidates: any[],
  analysis: VisualAnalysisUnderstanding,
  userQuery?: string
): HybridRankedProduct[] {
  // 1. Generate query vector representing the detected image visual characteristics
  const queryColors = analysis.colors && analysis.colors.length > 0
    ? analysis.colors
    : analysis.color && analysis.color !== "Multi-color"
    ? [analysis.color]
    : [];

  const queryVector = generateFeatureVector({
    category: analysis.category,
    productType: analysis.productType || analysis.subcategory,
    colors: queryColors,
    style: analysis.style,
    attributes: analysis.visualAttributes || analysis.features,
    title: analysis.title,
    tags: analysis.keywords,
  });

  // Extract strict product-type nouns from subcategory & title
  const subcatTypeNouns = extractTypeNouns(analysis.subcategory);
  const titleTypeNouns = extractTypeNouns(analysis.title);
  const allTypeNouns = Array.from(new Set([...subcatTypeNouns, ...titleTypeNouns]));

  const meaningfulKeywords = (analysis.keywords || []).filter(
    (kw) => !GENERIC_ADJECTIVES.has(kw.toLowerCase()) && !STOP_WORDS.has(kw.toLowerCase())
  );

  const scored: Array<HybridRankedProduct | null> = candidates.map((prod) => {
    const titleLower = (prod.title || "").toLowerCase();
    const categoryLower = (prod.category || "").toLowerCase();
    const descLower = (prod.description || "").toLowerCase();
    const prodTags = (prod.tags || []).map((t: string) => t.toLowerCase());
    const allProdText = `${titleLower} ${prodTags.join(" ")} ${descLower}`;

    // Model keyword matching (e.g. "Mercury K1" or "K1 Pro")
    const modelClean = (analysis.model || "").toLowerCase().trim();
    const modelWords = modelClean
      .split(/[\s-]+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !GENERIC_ADJECTIVES.has(w) && w !== "pro" && w !== "plus");
    const hasModelMatch =
      modelWords.length > 0 && modelWords.every((mw) => allProdText.includes(mw));

    // A. STRICT PRODUCT-TYPE GATE
    // Product MUST match at least one product-type noun if detected, or match exact model
    let hasStrictTypeMatch = false;
    let hasTitleTypeMatch = false;

    if (subcatTypeNouns.length > 0) {
      hasStrictTypeMatch = subcatTypeNouns.some((n) => matchNounInText(n, allProdText));
      if (!hasStrictTypeMatch) {
        hasTitleTypeMatch = titleTypeNouns.some((n) => matchNounInText(n, allProdText));
        if (!hasTitleTypeMatch && !hasModelMatch) {
          // Reject unrelated product types (e.g. AC when searching headphones)
          return null;
        }
      }
    } else if (titleTypeNouns.length > 0) {
      hasTitleTypeMatch = titleTypeNouns.some((n) => matchNounInText(n, allProdText));
      if (!hasTitleTypeMatch && !hasModelMatch) {
        return null;
      }
    }

    if (hasModelMatch) {
      hasStrictTypeMatch = true;
    }

    // B. CATEGORY GATE
    const catLower = (analysis.category || "").toLowerCase();
    const isCategoryMatch =
      !catLower ||
      catLower === "general" ||
      categoryLower.includes(catLower) ||
      catLower.includes(categoryLower);

    if (!isCategoryMatch && catLower && catLower !== "general") {
      return null;
    }

    // C. VECTOR SIMILARITY (Visual & Multimodal Feature Space)
    let visualSim = 0.5; // Baseline neutral similarity
    if (prod.visualEmbedding?.vector && Array.isArray(prod.visualEmbedding.vector)) {
      visualSim = cosineSimilarity(queryVector, prod.visualEmbedding.vector);
    } else {
      // Calculate on-the-fly vector if product hasn't been pre-indexed
      const prodVector = generateFeatureVector({
        category: prod.category,
        title: prod.title,
        tags: prod.tags,
      });
      visualSim = cosineSimilarity(queryVector, prodVector);
    }

    // Hybrid Scoring Signals:
    let score = 0;

    // 1. Visual Vector Similarity (up to 30 points)
    score += Math.round(visualSim * 30);

    // 2. Strict Product Type Match (up to 30 points)
    if (hasStrictTypeMatch) {
      score += 30;
    } else if (hasTitleTypeMatch) {
      score += 15;
    }

    // Exact Model Match Bonus (up to 25 points)
    if (hasModelMatch) {
      score += 25;
    }

    // 3. Brand Match (up to 20 points)
    const brandLower = (analysis.brand || "").toLowerCase().trim();
    const brandKeywords = brandLower.split(/[\s-]+/).filter((w) => w.length > 2);
    const brandInImages = (prod.images || []).some((img: string) => img.toLowerCase().includes(brandLower));
    const hasBrandMatch = Boolean(
      brandLower &&
        brandLower !== "generic" &&
        brandLower !== "unknown" &&
        (
          titleLower.includes(brandLower) ||
          prodTags.includes(brandLower) ||
          descLower.includes(brandLower) ||
          brandInImages ||
          (prod.brand && String(prod.brand).toLowerCase().includes(brandLower)) ||
          (brandKeywords.length > 0 && brandKeywords.some((bk) => allProdText.includes(bk)))
        )
    );
    if (hasBrandMatch) {
      score += 20;
    }

    // 4. Color Match (up to 10 points)
    let hasColorMatch = false;
    for (const c of queryColors) {
      const cLow = c.toLowerCase();
      if (
        cLow &&
        cLow !== "multi-color" &&
        (titleLower.includes(cLow) || prodTags.includes(cLow) || descLower.includes(cLow))
      ) {
        hasColorMatch = true;
        score += 10;
        break;
      }
    }

    // 5. Customer search query match (bonus up to 20 points)
    let queryExactMatched = false;
    if (userQuery) {
      const qClean = userQuery.toLowerCase().trim();
      if (titleLower.includes(qClean) || prodTags.includes(qClean)) {
        score += 20;
        queryExactMatched = true;
      } else {
        const queryWords = qClean.split(/[\s,]+/).filter((w) => !STOP_WORDS.has(w) && w.length > 2);
        const matchCount = queryWords.filter((w) => titleLower.includes(w) || prodTags.includes(w)).length;
        if (matchCount > 0) {
          score += Math.min(matchCount * 8, 15);
        }
      }
    }

    // 6. Semantic keyword / tags match (up to 10 points)
    const matchedKeywords = meaningfulKeywords.filter(
      (kw) => prodTags.some((t: string) => t.includes(kw.toLowerCase())) || titleLower.includes(kw.toLowerCase())
    );
    score += Math.min(matchedKeywords.length * 4, 10);

    // 7. Stock & Availability factor
    const inStock = (prod.stock ?? 1) > 0;
    if (!inStock) {
      score -= 10; // slightly de-rank out of stock items
    }

    // Clamp score to 10..99 range
    const finalScore = Math.min(Math.max(score, 10), 99);

    // Grouping labels
    let matchBadge: "Direct Match" | "Similar Style" | "Alternative" = "Alternative";
    let matchGroup: "HIGHLY SIMILAR" | "SIMILAR STYLE" | "ALTERNATIVE" = "ALTERNATIVE";

    if (finalScore >= 75 || hasModelMatch || (queryExactMatched && hasBrandMatch)) {
      matchBadge = "Direct Match";
      matchGroup = "HIGHLY SIMILAR";
    } else if (finalScore >= 55 || (hasStrictTypeMatch && hasBrandMatch)) {
      matchBadge = "Similar Style";
      matchGroup = "SIMILAR STYLE";
    }

    const result: HybridRankedProduct & { hasModelMatch?: boolean } = {
      _id: prod._id.toString(),
      title: prod.title,
      description: prod.description,
      price: prod.price,
      discountPrice: prod.discountPrice,
      category: prod.category,
      images: prod.images || [],
      ratingAvg: prod.ratingAvg,
      ratingCount: prod.ratingCount,
      stock: prod.stock,
      sold: prod.sold,
      sellerId: prod.sellerId,
      matchScore: finalScore,
      matchBadge,
      matchGroup,
      visualSimilarity: Number((visualSim * 100).toFixed(1)),
      breakdown: {
        visualSimilarity: Number((visualSim * 100).toFixed(1)),
        productTypeMatch: hasStrictTypeMatch || hasTitleTypeMatch || hasModelMatch,
        categoryMatch: isCategoryMatch,
        brandMatch: !!hasBrandMatch,
        colorMatch: hasColorMatch,
        inStock,
      },
      hasModelMatch,
    };

    return result;
  });

  // User Requirement: Show genuine matching products (same or similar products) from platform catalog.
  // Filters out completely unrelated items (e.g. AC when searching for a keyboard).
  const validProducts = scored.filter((p): p is HybridRankedProduct => {
    if (!p) return false;
    // Must have matching product type or model match (to prevent completely unrelated products)
    if (!p.breakdown.productTypeMatch) return false;
    // Minimum match score for relevant products
    return p.matchScore >= 35;
  });

  // Sort primarily by matchScore descending (Direct Matches first, then Similar Style), then stock and rating
  validProducts.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const aStock = (a.stock ?? 1) > 0 ? 1 : 0;
    const bStock = (b.stock ?? 1) > 0 ? 1 : 0;
    if (bStock !== aStock) return bStock - aStock;
    return (b.ratingAvg || 0) - (a.ratingAvg || 0);
  });

  return validProducts;
}
