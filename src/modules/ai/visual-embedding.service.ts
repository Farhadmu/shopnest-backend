import { Product, IProduct } from "../products/product.model";
import { logger } from "../../utils/logger";

const VECTOR_DIMENSIONS = 64;

// Color coordinate map in normalized RGB space (0-1) for visual color vectoring
const COLOR_MAP: Record<string, [number, number, number]> = {
  black: [0.0, 0.0, 0.0],
  white: [1.0, 1.0, 1.0],
  red: [1.0, 0.0, 0.0],
  blue: [0.0, 0.3, 0.9],
  green: [0.0, 0.8, 0.3],
  yellow: [1.0, 0.9, 0.0],
  orange: [1.0, 0.5, 0.0],
  purple: [0.6, 0.1, 0.8],
  pink: [1.0, 0.4, 0.7],
  brown: [0.55, 0.27, 0.07],
  gray: [0.5, 0.5, 0.5],
  grey: [0.5, 0.5, 0.5],
  silver: [0.75, 0.75, 0.75],
  gold: [0.85, 0.65, 0.13],
  navy: [0.0, 0.0, 0.5],
  beige: [0.96, 0.96, 0.86],
  teal: [0.0, 0.5, 0.5],
  maroon: [0.5, 0.0, 0.0],
};

/**
 * Standard Cosine Similarity between two numeric vectors.
 * Returns value strictly between 0 and 1.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  // Normalize [-1, 1] to [0, 1]
  return Math.max(0, Math.min(1, (similarity + 1) / 2));
}

/**
 * Fast deterministic hash for token feature hashing
 */
function hashToken(str: string, seed = 0): number {
  let h = seed ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Generates a normalized unit-length multimodal feature vector
 * combining category, product type, visual attributes, colors, and token embeddings.
 */
export function generateFeatureVector(params: {
  category?: string;
  productType?: string;
  colors?: string[];
  style?: string[];
  attributes?: string[];
  title?: string;
  tags?: string[];
}): number[] {
  const vec = new Float64Array(VECTOR_DIMENSIONS);

  // 1. Color visual projection (indices 0 to 5)
  const colors = (params.colors || []).map((c) => c.toLowerCase().trim());
  let r = 0.5;
  let g = 0.5;
  let b = 0.5;
  let colorCount = 0;

  for (const c of colors) {
    if (COLOR_MAP[c]) {
      const [cr, cg, cb] = COLOR_MAP[c];
      r += cr;
      g += cg;
      b += cb;
      colorCount++;
    }
  }

  if (colorCount > 0) {
    r /= colorCount + 1;
    g /= colorCount + 1;
    b /= colorCount + 1;
  }

  vec[0] = r;
  vec[1] = g;
  vec[2] = b;
  vec[3] = Math.sqrt(r * r + g * g + b * b); // luminance
  vec[4] = Math.abs(r - g);
  vec[5] = Math.abs(b - r);

  // 2. Category & Product Type projection (indices 6 to 19)
  const categoryStr = (params.category || "").toLowerCase();
  const productTypeStr = (params.productType || "").toLowerCase();
  if (categoryStr) {
    const h = hashToken(categoryStr);
    const idx = 6 + (h % 7);
    vec[idx] += 1.5;
  }
  if (productTypeStr) {
    const h = hashToken(productTypeStr);
    const idx = 13 + (h % 7);
    vec[idx] += 2.0;
  }

  // 3. Style & Attributes token projection (indices 20 to 39)
  const styleAttrs = [...(params.style || []), ...(params.attributes || [])];
  for (const attr of styleAttrs) {
    const clean = attr.toLowerCase().trim();
    if (!clean) continue;
    const h = hashToken(clean);
    const idx = 20 + (h % 20);
    vec[idx] += 1.0;
  }

  // 4. Semantic Title & Tags token projection (indices 40 to 63)
  const titleTokens = (params.title || "").toLowerCase().split(/[\s,._-]+/).filter((t) => t.length > 2);
  const tagTokens = (params.tags || []).map((t) => t.toLowerCase().trim());
  const allTokens = [...titleTokens, ...tagTokens];

  for (const tok of allTokens) {
    const h = hashToken(tok);
    const idx = 40 + (h % 24);
    vec[idx] += 0.8;
  }

  // 5. L2-Normalize vector to unit length
  let sumSq = 0;
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    sumSq += vec[i] * vec[i];
  }

  const norm = Math.sqrt(sumSq);
  const result: number[] = new Array(VECTOR_DIMENSIONS);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
      result[i] = Number((vec[i] / norm).toFixed(6));
    }
  } else {
    for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
      result[i] = 0;
    }
  }

  return result;
}

/**
 * Indexes visual embedding for a specific product without blocking calling operations
 */
export async function indexProductVisualEmbedding(productId: string): Promise<void> {
  try {
    const product = await Product.findById(productId);
    if (!product) return;

    // Detect attributes from title, category, tags
    const colors: string[] = [];
    const textLower = `${product.title} ${product.category} ${(product.tags || []).join(" ")}`.toLowerCase();
    for (const [colName] of Object.entries(COLOR_MAP)) {
      if (textLower.includes(colName)) {
        colors.push(colName);
      }
    }

    const vector = generateFeatureVector({
      category: product.category,
      productType: product.tags?.[0] || product.category,
      colors,
      title: product.title,
      tags: product.tags,
    });

    product.visualEmbedding = {
      vector,
      model: "multimodal-sim-v1",
      generatedAt: new Date(),
      status: "indexed",
    };

    if (colors.length > 0 && (!product.visualAttributes?.dominantColors || product.visualAttributes.dominantColors.length === 0)) {
      product.visualAttributes = {
        dominantColors: colors,
        style: product.tags?.slice(0, 3) || [],
        productType: product.tags?.[0] || product.category,
      };
    }

    await product.save();
    logger.info("Product visual embedding indexed successfully", { productId });
  } catch (err: any) {
    logger.warn("Failed to index product visual embedding", { productId, error: err?.message });
    try {
      await Product.findByIdAndUpdate(productId, {
        "visualEmbedding.status": "failed",
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Backfill indexing for catalog products missing visual embeddings
 */
export async function ensureCatalogEmbeddingsIndexed(limit = 100): Promise<number> {
  try {
    const unindexedProducts = await Product.find({
      $or: [
        { visualEmbedding: { $exists: false } },
        { "visualEmbedding.vector": { $exists: false } },
        { "visualEmbedding.status": "pending" },
      ],
      isDeleted: false,
    })
      .limit(limit)
      .lean();

    let count = 0;
    for (const prod of unindexedProducts) {
      await indexProductVisualEmbedding(prod._id.toString());
      count++;
    }
    return count;
  } catch (err: any) {
    logger.warn("Catalog embedding indexing job failed", { error: err?.message });
    return 0;
  }
}
