import { Request, Response } from "express";
import { AiConversation } from "./conversation.model";
import { Product } from "../../products/product.model";
import { Category } from "../../categories/category.model";
import { complete } from "../providers/claude.provider";
import { SHOPPING_ASSISTANT_SYSTEM, buildProductContext } from "../prompts";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { logAiIncident } from "../incident/incident.service";
import { buildPublicProductFilter, getPublicProduct } from "../../../utils/activeProductFilter";

interface RankedProduct {
  id: string;
  title: string;
  price: number;
  category: string;
  ratingAvg: number;
  stock: number;
  matchScore: number;
  reason: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
  specifications?: Record<string, string>;
  warrantyMonths?: number;
  freeDelivery?: boolean;
  sentiment?: { positive: number; neutral: number; negative: number };
}

interface ProductCandidate {
  id: string;
  title: string;
  price: number;
  category: string;
  ratingAvg: number;
  stock: number;
  discountPrice?: number;
  specifications?: Record<string, string>;
  warrantyMonths?: number;
  freeDelivery?: boolean;
  sentiment?: { positive: number; neutral: number; negative: number };
}

interface QueryInterpretation {
  category: string;
  useCase: string;
  maxPrice: number | undefined;
  minPrice: number | undefined;
  priorities: string[];
  intent: "recommendation" | "comparison" | "search" | "general";
  constraints: string[];
}

const CATEGORY_PRIORITIES: Record<string, Array<{ keywords: string[]; priorities: string[]; weights: Record<string, number> }>> = {
  laptop: [
    { keywords: ["programming", "coder", "developer", "software"], priorities: ["cpu", "ram", "ssd", "battery", "keyboard", "display"], weights: { cpu: 0.25, ram: 0.2, ssd: 0.15, battery: 0.2, keyboard: 0.1, display: 0.1 } },
    { keywords: ["gaming", "game"], priorities: ["gpu", "cpu", "ram", "display", "cooling", "battery"], weights: { gpu: 0.3, cpu: 0.2, ram: 0.15, display: 0.15, cooling: 0.1, battery: 0.1 } },
    { keywords: ["office", "business", "work"], priorities: ["battery", "keyboard", "portability", "ram", "ssd", "price"], weights: { battery: 0.25, keyboard: 0.15, portability: 0.2, ram: 0.15, ssd: 0.15, price: 0.1 } },
    { keywords: ["student"], priorities: ["price", "battery", "durability", "performance"], weights: { price: 0.3, battery: 0.2, durability: 0.2, performance: 0.3 } },
  ],
  phone: [
    { keywords: ["gaming", "game"], priorities: ["chipset", "gpu", "ram", "display", "battery", "cooling"], weights: { chipset: 0.3, gpu: 0.2, ram: 0.15, display: 0.15, battery: 0.1, cooling: 0.1 } },
    { keywords: ["camera", "photography", "photo"], priorities: ["camera", "display", "battery", "storage"], weights: { camera: 0.4, display: 0.2, battery: 0.2, storage: 0.2 } },
    { keywords: ["battery", "long lasting"], priorities: ["battery", "display", "chipset", "ram"], weights: { battery: 0.4, display: 0.2, chipset: 0.2, ram: 0.2 } },
  ],
  headphone: [
    { keywords: ["gaming"], priorities: ["sound", "comfort", "microphone", "battery"], weights: { sound: 0.3, comfort: 0.25, microphone: 0.25, battery: 0.2 } },
    { keywords: ["music", "audio"], priorities: ["sound", "battery", "comfort"], weights: { sound: 0.5, battery: 0.3, comfort: 0.2 } },
  ],
};

function interpretQuery(message: string): QueryInterpretation {
  const lower = message.toLowerCase();
  const budgetMatch = message.match(/(\d{2,7})/);
  const maxPrice = budgetMatch ? Number(budgetMatch[1]) : undefined;

  let category = "";
  let useCase = "";
  let priorities: string[] = [];
  let weights: Record<string, number> = {};

  if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) {
    category = "laptop";
    for (const profile of CATEGORY_PRIORITIES.laptop) {
      if (profile.keywords.some((k) => lower.includes(k))) {
        useCase = profile.keywords[0];
        priorities = profile.priorities;
        weights = profile.weights;
        break;
      }
    }
    if (!useCase) {
      useCase = "general";
      priorities = ["cpu", "ram", "ssd", "battery", "price"];
      weights = { cpu: 0.2, ram: 0.2, ssd: 0.15, battery: 0.2, price: 0.25 };
    }
  } else if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) {
    category = "phone";
    for (const profile of CATEGORY_PRIORITIES.phone) {
      if (profile.keywords.some((k) => lower.includes(k))) {
        useCase = profile.keywords[0];
        priorities = profile.priorities;
        weights = profile.weights;
        break;
      }
    }
    if (!useCase) {
      useCase = "general";
      priorities = ["chipset", "camera", "battery", "display", "price"];
      weights = { chipset: 0.2, camera: 0.2, battery: 0.2, display: 0.2, price: 0.2 };
    }
  } else if (lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone")) {
    category = "headphone";
    for (const profile of CATEGORY_PRIORITIES.headphone) {
      if (profile.keywords.some((k) => lower.includes(k))) {
        useCase = profile.keywords[0];
        priorities = profile.priorities;
        weights = profile.weights;
        break;
      }
    }
    if (!useCase) {
      useCase = "general";
      priorities = ["sound", "battery", "comfort"];
      weights = { sound: 0.4, battery: 0.3, comfort: 0.3 };
    }
  }

  const constraints: string[] = [];
  if (maxPrice) constraints.push(`budget <= ৳${maxPrice}`);
  if (lower.includes("under") || lower.includes("below")) constraints.push(`price under ৳${maxPrice || "?"}`);
  if (lower.includes("cheap") || lower.includes("cheaper")) constraints.push("price sensitive");
  if (lower.includes("best") || lower.includes("top")) constraints.push("quality priority");

  return {
    category,
    useCase,
    maxPrice,
    minPrice: undefined,
    priorities,
    intent: "recommendation",
    constraints,
  };
}

function extractSpecificationValue(specs: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!specs) return undefined;
  const lowerSpecs = Object.fromEntries(Object.entries(specs).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(lowerSpecs)) {
      if (k.includes(lowerKey) || lowerKey.includes(k)) {
        return v;
      }
    }
  }
  return undefined;
}

function scoreProductForQuery(product: ProductCandidate, query: QueryInterpretation): number {
  if (!query.category) return (product.ratingAvg || 0) / 5;

  const weights = { ...query.priorities.reduce((acc, p) => ({ ...acc, [p]: 1 / query.priorities.length }), {} as Record<string, number>) };
  const defaultWeights: Record<string, number> = {
    rating: 0.3,
    price: 0.25,
    availability: 0.2,
    value: 0.15,
    delivery: 0.1,
  };

  const finalWeights = { ...defaultWeights, ...weights };

  let score = 0;
  let totalWeight = 0;

  for (const [factor, weight] of Object.entries(finalWeights)) {
    let factorScore = 0.5;

    switch (factor) {
      case "rating":
        factorScore = Math.min(1, (product.ratingAvg || 0) / 5);
        break;
      case "price":
      case "value":
        if (query.maxPrice && product.price <= query.maxPrice) {
          factorScore = 1 - product.price / (query.maxPrice || 1);
        } else if (query.maxPrice) {
          factorScore = 0;
        }
        break;
      case "availability":
      case "stock":
        factorScore = product.stock > 0 ? 1 : 0;
        break;
      case "delivery":
        factorScore = product.freeDelivery ? 1 : 0.5;
        break;
      case "battery":
      case "cpu":
      case "ram":
      case "ssd":
      case "gpu":
      case "display":
      case "camera":
      case "chipset":
      case "cooling":
      case "keyboard":
      case "portability":
      case "durability":
      case "sound":
      case "comfort":
      case "microphone":
      case "storage":
        if (product.specifications) {
          const value = extractSpecificationValue(product.specifications, [factor]);
          if (value) {
            factorScore = 0.8;
          } else {
            factorScore = 0.3;
          }
        } else {
          factorScore = 0.3;
        }
        break;
      default:
        factorScore = 0.5;
    }

    score += factorScore * weight;
    totalWeight += weight;
  }

  if (totalWeight > 0) {
    score = score / totalWeight;
  }

  return Math.round(score * 100);
}

function generateProductStrengths(product: ProductCandidate, query: QueryInterpretation): string[] {
  const strengths: string[] = [];

  if (product.ratingAvg >= 4) strengths.push(`Highly rated (${product.ratingAvg}/5)`);
  if (product.stock > 0) strengths.push("In stock");
  if (product.freeDelivery) strengths.push("Free delivery");
  if (query.maxPrice && product.price <= query.maxPrice) strengths.push("Within budget");
  if (product.warrantyMonths && product.warrantyMonths >= 12) strengths.push(`Includes ${product.warrantyMonths}-month warranty`);
  if (product.sentiment && product.sentiment.positive > 70) strengths.push("Positive customer sentiment");

  return strengths.slice(0, 4);
}

function generateProductWeaknesses(product: ProductCandidate, query: QueryInterpretation): string[] {
  const weaknesses: string[] = [];

  if (product.ratingAvg < 3.5) weaknesses.push("Below-average rating");
  if (product.stock === 0) weaknesses.push("Out of stock");
  if (query.maxPrice && product.price > query.maxPrice) weaknesses.push(`Exceeds budget by ৳${product.price - query.maxPrice}`);
  if (!product.specifications || Object.keys(product.specifications).length === 0) weaknesses.push("Limited specification details available");
  if (product.sentiment && product.sentiment.negative > 30) weaknesses.push("Some negative customer feedback");

  return weaknesses.slice(0, 3);
}

function generateBestFor(product: ProductCandidate, query: QueryInterpretation): string {
  if (query.useCase === "programming") {
    return "Developers who need a reliable machine for coding, with good battery life for mobility.";
  } else if (query.useCase === "gaming") {
    return "Gamers looking for smooth gameplay and responsive controls.";
  } else if (query.useCase === "office") {
    return "Professionals needing a portable, reliable device for daily work tasks.";
  } else if (query.useCase === "photography") {
    return "Photography enthusiasts who want detailed, vibrant image capture.";
  } else {
    return "Users looking for a solid all-around option in this category.";
  }
}

/** Very lightweight keyword extraction to pull candidate products before asking the model to reason over them. */
async function findCandidateProducts(message: string) {
  const lower = message.toLowerCase();
  const budgetMatch = message.match(/(\d{2,7})/);
  const maxPrice = budgetMatch ? Number(budgetMatch[1]) : undefined;

  const filter = await buildPublicProductFilter({});
  if (maxPrice && maxPrice > 0) {
    filter.price = { $lte: maxPrice };
  }

  let categoryHint = "";
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) categoryHint = "Electronics & Gadgets";
  else if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) categoryHint = "Computers & Accessories";
  else if (lower.includes("mouse") || lower.includes("keyboard") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone") || lower.includes("soundbox") || lower.includes("speaker")) categoryHint = "Electronics & Gadgets";
  else if (lower.includes("shirt") || lower.includes("t-shirt") || lower.includes("saree") || lower.includes("panjabi") || lower.includes("dress") || lower.includes("pant") || lower.includes("jacket")) categoryHint = "Fashion & Clothing";
  else if (lower.includes("watch") || lower.includes("smartwatch") || lower.includes("bag") || lower.includes("wallet") || lower.includes("perfume")) categoryHint = "Fashion & Clothing";

  const textSearch = message.replace(/[^a-zA-Z\s\u0980-\u09FF]/g, " ").trim();
  const searchTokens = textSearch.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3);

  const stopWords = new Set(["the", "and", "for", "with", "under", "over", "from", "than", "best", "good", "price", "budget", "range", "want", "need", "show", "find", "looking", "recommend", "suggest", "tell", "about", "what", "which", "this", "that", "have", "does", "do", "is", "are", "was", "were", "been", "being", "have", "has", "had", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "cannot", "not", "no", "yes", "but", "because", "since", "although", "though", "however", "therefore", "thus", "hence", "so", "yet", "still", "also", "very", "too", "quite", "rather", "some", "any", "all", "each", "every", "both", "few", "many", "much", "more", "most", "less", "least", "own", "same", "such", "only", "just", "now", "then", "here", "there", "where", "when", "why", "how", "again", "ever", "never", "always", "often", "usually", "sometimes", "maybe", "perhaps", "please", "thank", "thanks", "sorry", "hello", "hi", "hey", "goodbye", "bye"]);
  const effectiveTokens = searchTokens.filter((t) => !stopWords.has(t.toLowerCase()));

  const products: ProductCandidate[] = [];

  if (categoryHint) {
    const categoryFilter = { ...filter, category: { $regex: categoryHint, $options: "i" } } as Record<string, unknown>;
    if (effectiveTokens.length > 0) {
      const tokenConditions = effectiveTokens.map((token) => ({
        $or: [
          { title: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { tags: { $regex: token, $options: "i" } },
          { description: { $regex: token, $options: "i" } },
        ],
      }));
      const allOr = tokenConditions.flatMap((tc) => (tc as any).$or as Array<Record<string, unknown>>);
      (categoryFilter as any).$or = allOr;
    }
    const categoryResults = await Product.find(categoryFilter as any).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...categoryResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  if (products.length === 0 && effectiveTokens.length > 0) {
    const relaxedFilter = { ...filter } as Record<string, unknown>;
    const tokenConditions = effectiveTokens.slice(0, 4).map((token) => ({
      $or: [
        { title: { $regex: token, $options: "i" } },
        { category: { $regex: token, $options: "i" } },
        { tags: { $regex: token, $options: "i" } },
        { description: { $regex: token, $options: "i" } },
      ],
    }));
    const allOr = tokenConditions.flatMap((tc) => (tc as any).$or as Array<Record<string, unknown>>);
    (relaxedFilter as any).$or = allOr;
    const relaxedResults = await Product.find(relaxedFilter as any).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...relaxedResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  if (products.length === 0 && maxPrice && maxPrice > 0) {
    const budgetResults = await Product.find({ ...filter, price: { $lte: maxPrice } }).sort({ ratingAvg: -1 }).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...budgetResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  return products.map((p) => ({
    id: p.id,
    title: p.title,
    price: p.discountPrice ?? p.price,
    category: p.category,
    ratingAvg: p.ratingAvg,
    stock: p.stock,
    specifications: p.specifications instanceof Map ? Object.fromEntries(p.specifications) : { ...(p.specifications || {}) },
    warrantyMonths: p.warrantyMonths,
    freeDelivery: p.freeDelivery,
    sentiment: p.sentiment,
  }));
}

async function validateProducts(products: ProductCandidate[]): Promise<ProductCandidate[]> {
  if (products.length === 0) return [];
  const ids = products.map((p) => p.id);
  const validProducts = await Product.find({ _id: { $in: ids }, isDeleted: false }).select("_id title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
  const validIds = new Set(validProducts.map((p: any) => p._id?.toString()));
  return products.filter((p) => validIds.has(p.id));
}

async function findRelaxedCandidateProducts(message: string): Promise<ProductCandidate[]> {
  const lower = message.toLowerCase();
  const budgetMatch = message.match(/(\d{2,7})/);
  const maxPrice = budgetMatch ? Number(budgetMatch[1]) : undefined;

  const filter = await buildPublicProductFilter({});

  let categoryHint = "";
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("smartphone")) categoryHint = "Electronics & Gadgets";
  else if (lower.includes("laptop") || lower.includes("computer") || lower.includes("pc") || lower.includes("macbook")) categoryHint = "Computers & Accessories";
  else if (lower.includes("mouse") || lower.includes("keyboard") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("earphone") || lower.includes("soundbox") || lower.includes("speaker")) categoryHint = "Electronics & Gadgets";
  else if (lower.includes("shirt") || lower.includes("t-shirt") || lower.includes("saree") || lower.includes("panjabi") || lower.includes("dress") || lower.includes("pant") || lower.includes("jacket")) categoryHint = "Fashion & Clothing";
  else if (lower.includes("watch") || lower.includes("smartwatch") || lower.includes("bag") || lower.includes("wallet") || lower.includes("perfume")) categoryHint = "Fashion & Clothing";

  const textSearch = message.replace(/[^a-zA-Z\s\u0980-\u09FF]/g, " ").trim();
  const searchTokens = textSearch.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3);

  const stopWords = new Set(["the", "and", "for", "with", "under", "over", "from", "than", "best", "good", "price", "budget", "range", "want", "need", "show", "find", "looking", "recommend", "suggest", "tell", "about", "what", "which", "this", "that", "have", "does", "do", "is", "are", "was", "were", "been", "being", "have", "has", "had", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "cannot", "not", "no", "yes", "but", "because", "since", "although", "though", "however", "therefore", "thus", "hence", "so", "yet", "still", "also", "very", "too", "quite", "rather", "some", "any", "all", "each", "every", "both", "few", "many", "much", "more", "most", "less", "least", "own", "same", "such", "only", "just", "now", "then", "here", "there", "where", "when", "why", "how", "again", "ever", "never", "always", "often", "usually", "sometimes", "maybe", "perhaps", "please", "thank", "thanks", "sorry", "hello", "hi", "hey", "goodbye", "bye"]);
  const effectiveTokens = searchTokens.filter((t) => !stopWords.has(t.toLowerCase()));

  const products: ProductCandidate[] = [];

  if (categoryHint) {
    const categoryFilter = { ...filter, category: { $regex: categoryHint, $options: "i" } } as Record<string, unknown>;
    if (effectiveTokens.length > 0) {
      const tokenConditions = effectiveTokens.slice(0, 3).map((token) => ({
        $or: [
          { title: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { tags: { $regex: token, $options: "i" } },
        ],
      }));
      const allOr = tokenConditions.flatMap((tc) => (tc as any).$or as Array<Record<string, unknown>>);
      (categoryFilter as any).$or = allOr;
    }
    const categoryResults = await Product.find(categoryFilter as any).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...categoryResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  if (products.length === 0 && effectiveTokens.length > 0) {
    const relaxedFilter = { ...filter } as Record<string, unknown>;
    const tokenConditions = effectiveTokens.slice(0, 3).map((token) => ({
      $or: [
        { title: { $regex: token, $options: "i" } },
        { category: { $regex: token, $options: "i" } },
        { tags: { $regex: token, $options: "i" } },
      ],
    }));
    const allOr = tokenConditions.flatMap((tc) => (tc as any).$or as Array<Record<string, unknown>>);
    (relaxedFilter as any).$or = allOr;
    const relaxedResults = await Product.find(relaxedFilter as any).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...relaxedResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  if (products.length === 0 && maxPrice && maxPrice > 0) {
    const relaxedMax = maxPrice * 1.2;
    const budgetResults = await Product.find({ ...filter, price: { $lte: relaxedMax } }).sort({ ratingAvg: -1 }).limit(8).select("title price category ratingAvg stock discountPrice specifications warrantyMonths freeDelivery sentiment").lean();
    products.push(...budgetResults.map((p: any) => ({ ...p, id: p._id?.toString() })));
  }

  return products.map((p) => ({
    id: p.id,
    title: p.title,
    price: p.discountPrice ?? p.price,
    category: p.category,
    ratingAvg: p.ratingAvg,
    stock: p.stock,
    specifications: p.specifications instanceof Map ? Object.fromEntries(p.specifications) : { ...(p.specifications || {}) },
    warrantyMonths: p.warrantyMonths,
    freeDelivery: p.freeDelivery,
    sentiment: p.sentiment,
  }));
}

function rankProducts(products: ProductCandidate[], query: QueryInterpretation): RankedProduct[] {
  if (products.length === 0) return [];

  return products
    .map((p) => {
      const score = scoreProductForQuery(p, query);
      const strengths = generateProductStrengths(p, query);
      const weaknesses = generateProductWeaknesses(p, query);
      const bestFor = generateBestFor(p, query);

      return {
        ...p,
        matchScore: score,
        reason: strengths.slice(0, 2).join(", ") || "matches your criteria",
        strengths,
        weaknesses,
        bestFor,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

export const chat = asyncHandler(async (req: Request, res: Response) => {
  const { message, conversationId } = req.body as { message: string; conversationId?: string };
  const userId = req.user?.id;

  let conversation = null;
  if (userId) {
    conversation = conversationId
      ? await AiConversation.findOne({ _id: conversationId, userId })
      : null;
    if (!conversation) conversation = await AiConversation.create({ userId, messages: [] });
    conversation.messages.push({ role: "user", content: message, at: new Date() });
  }

  const query = interpretQuery(message);
  const candidates = await findCandidateProducts(message);
  const validatedCandidates = await validateProducts(candidates);
  const rankedCandidates = rankProducts(validatedCandidates, query);

  let reply: string;
  let isFallback = false;
  let provider: string | undefined;

  if (rankedCandidates.length === 0) {
    const relaxedCandidates = await findRelaxedCandidateProducts(message);
    const validatedRelaxed = await validateProducts(relaxedCandidates);
    const relaxedRanked = rankProducts(validatedRelaxed, query);

    if (relaxedRanked.length > 0) {
      const best = relaxedRanked[0];
      const relaxedContext = buildProductContext(relaxedRanked.slice(0, 3));
      const history = conversation ? conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) : [];
      const result = await complete(
        [
          ...history.slice(0, -1),
          {
            role: "user" as const,
            content: `No exact match found for: ${message}\n\nClosest alternatives after relaxing constraints:\n${relaxedContext}\n\nExplain why exact match failed and what changed for the closest alternative. Be specific about constraints relaxed.`,
          },
        ],
        { system: SHOPPING_ASSISTANT_SYSTEM }
      );
      reply = result.content;
      isFallback = result.isFallback;
      provider = result.provider;

      if (conversation) {
        conversation.messages.push({ role: "assistant", content: reply, at: new Date() });
        await conversation.save();
      }

      const response: Record<string, unknown> = {
        conversationId: conversation?.id,
        reply,
        noMatch: true,
        relaxedMatch: true,
        relaxedReason: `No exact match found for all constraints. Showing closest ${relaxedRanked.length} alternative(s).`,
        suggestedProducts: relaxedRanked.slice(0, 5).map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          category: p.category,
          ratingAvg: p.ratingAvg,
          stock: p.stock,
          matchScore: p.matchScore,
          reason: p.reason,
          strengths: p.strengths,
          weaknesses: p.weaknesses,
          bestFor: p.bestFor,
          specifications: p.specifications,
          warrantyMonths: p.warrantyMonths,
          freeDelivery: p.freeDelivery,
          sentiment: p.sentiment,
        })),
        isFallback,
        provider,
        providerStatus: isFallback ? "unavailable" : "available",
      };

      sendSuccess(res, response);
      return;
    }

    const history = conversation ? conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) : [];
    const result = await complete(
      [
        ...history.slice(0, -1),
        {
          role: "user" as const,
          content: `No products found matching: ${message}. State clearly that no exact match was found. Do not invent products.`,
        },
      ],
      { system: SHOPPING_ASSISTANT_SYSTEM }
    );
    reply = result.content;
    isFallback = result.isFallback;
    provider = result.provider;

    if (conversation) {
      conversation.messages.push({ role: "assistant", content: reply, at: new Date() });
      await conversation.save();
    }

    const response: Record<string, unknown> = {
      conversationId: conversation?.id,
      reply,
      noMatch: true,
      relaxedMatch: false,
      relaxedReason: "No products found matching the specified constraints.",
      suggestedProducts: [],
      isFallback,
      provider,
      providerStatus: isFallback ? "unavailable" : "available",
    };

    sendSuccess(res, response);
    return;
  }

  const context = buildProductContext(rankedCandidates);
  const history = conversation ? conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })) : [];

  try {
    const result = await complete(
      [...history.slice(0, -1), { role: "user" as const, content: `${context}\n\nCustomer: ${message}` }],
      { system: SHOPPING_ASSISTANT_SYSTEM }
    );
    reply = result.content;
    isFallback = result.isFallback;
    provider = result.provider;
  } catch (err) {
    if (userId) {
      await logAiIncident({
        type: "PROVIDER_ERROR",
        userId,
        endpoint: "/ai/chat",
        input: message,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (conversation) {
    conversation.messages.push({ role: "assistant", content: reply, at: new Date() });
    await conversation.save();
  }

  const response: Record<string, unknown> = {
    conversationId: conversation?.id,
    reply,
    noMatch: false,
    relaxedMatch: false,
    suggestedProducts: rankedCandidates.slice(0, 5).map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      category: p.category,
      ratingAvg: p.ratingAvg,
      stock: p.stock,
      matchScore: p.matchScore,
      reason: p.reason,
      strengths: p.strengths,
      weaknesses: p.weaknesses,
      bestFor: p.bestFor,
      specifications: p.specifications,
      warrantyMonths: p.warrantyMonths,
      freeDelivery: p.freeDelivery,
      sentiment: p.sentiment,
    })),
    isFallback,
    provider,
    providerStatus: isFallback ? "unavailable" : "available",
  };

  sendSuccess(res, response);
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await AiConversation.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  sendSuccess(res, conversation.toJSON());
});
