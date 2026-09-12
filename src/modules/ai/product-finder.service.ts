import { env } from "../../config/env";
import { logger } from "../../utils/logger";

export type ResearchStep =
  | "image_quality"
  | "vision_analysis"
  | "product_identification"
  | "web_research"
  | "source_verification"
  | "price_research"
  | "image_discovery"
  | "image_generation"
  | "listing_generation";

export interface ResearchProgress {
  step: ResearchStep;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ProductSource {
  url: string;
  title: string;
  snippet: string;
  publishedDate?: string;
  domain: string;
  type: "official" | "retailer" | "review" | "database" | "other";
}

export interface PriceObservation {
  amount: number;
  currency: string;
  source: string;
  sourceUrl: string;
  observedAt: string;
  isVerified: boolean;
}

export interface DiscoveredImage {
  url: string;
  sourceUrl: string;
  sourceType: "manufacturer" | "retailer" | "other";
  licenseStatus: "unknown" | "permitted" | "restricted";
}

export interface ProductResearchResult {
  productFound: boolean;
  confidence: "high" | "medium" | "low" | "none";
  identifiedProduct: {
    name: string;
    brand: string;
    model: string;
    category: string;
    subcategory: string;
    productType: string;
    color?: string;
    material?: string;
    variant?: string;
  } | null;
  sources: ProductSource[];
  verificationStatus: Record<string, "verified" | "partially_verified" | "not_verified" | "conflicting">;
  priceResearch: {
    observedPrices: PriceObservation[];
    suggestedPrice: number | null;
    priceRange: { min: number | null; max: number | null };
    currency: string;
    reasoning: string;
    researchStatus: "verified" | "partially_verified" | "not_verified";
  } | null;
  discoveredImages: DiscoveredImage[];
  generatedImages: string[];
  content: {
    title: string;
    category: string;
    subcategory: string;
    brand: string;
    model: string;
    description: string;
    shortDescription: string;
    features: string[];
    specifications: Record<string, string>;
    variants: Array<{ name: string; color?: string; priceDelta?: number }>;
    highlights: string[];
    whyBuy: string;
    seoTitle: string;
    seoDescription: string;
    tags: string[];
    marketingCaption: string;
    packageContents: string[];
    warranty: string;
    suggestedPrice: number | null;
    priceReasoning: string;
  } | null;
  limitations: string[];
  progress: ResearchProgress[];
}

export async function checkImageQuality(imageUrl: string): Promise<{ usable: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(imageUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "ShopNest-ImageQualityCheck/1.0" },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { usable: false, reason: `Image not accessible (HTTP ${response.status})` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return { usable: false, reason: `Invalid image format: ${contentType}` };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > 10 * 1024 * 1024) {
      return { usable: false, reason: "Image too large (>10MB)" };
    }

    return { usable: true };
  } catch {
    return { usable: false, reason: "Unable to access image for quality check" };
  }
}

export async function searchWeb(query: string): Promise<{ results: ProductSource[]; status: "success" | "failed" | "skipped"; error?: string }> {
  if (!env.SEARCH_API_KEY || !env.SEARCH_API_URL) {
    return {
      results: [],
      status: "skipped",
      error: "Online research is currently unavailable. No search provider is configured.",
    };
  }

  try {
    const apiUrl = env.SEARCH_API_URL;
    const apiKey = env.SEARCH_API_KEY;

    let searchUrl: string;
    let headers: Record<string, string> = { "Content-Type": "application/json" };

    if (apiUrl.includes("serpapi.com")) {
      searchUrl = `${apiUrl}?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}&num=10`;
    } else if (apiUrl.includes("googleapis.com") || apiUrl.includes("customsearch")) {
      searchUrl = `${apiUrl}?q=${encodeURIComponent(query)}&cx=${apiKey}&num=10`;
    } else if (apiUrl.includes("bing") || apiUrl.includes("microsoft")) {
      searchUrl = `${apiUrl}/v7.0/search?q=${encodeURIComponent(query)}`;
      headers["Ocp-Apim-Subscription-Key"] = apiKey;
    } else {
      searchUrl = `${apiUrl}?q=${encodeURIComponent(query)}&num=10`;
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      return {
        results: [],
        status: "failed",
        error: `Search service returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { items?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>>; webPages?: { value?: Array<Record<string, unknown>> } };
    let items = data.items || data.results || data.webPages?.value || [];

    const results: ProductSource[] = items.map((item: Record<string, unknown>): ProductSource => {
      const link = String(item.link || item.url || item.displayUrl || "");
      return {
        url: link,
        title: String(item.title || item.name || ""),
        snippet: String(item.snippet || item.description || item.summary || ""),
        publishedDate: item.publishedDate ? String(item.publishedDate) : undefined,
        domain: link ? new URL(link).hostname : "unknown",
        type: link ? classifySource(link) : "other",
      };
    });

    return { results, status: "success" };
  } catch (error) {
    logger.error("Web search failed", { error });
    return {
      results: [],
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown search error",
    };
  }
}

function classifySource(url: string): ProductSource["type"] {
  const domain = new URL(url).hostname.toLowerCase();
  if (domain.includes("manufacturer") || domain.includes("official") || domain.includes("brand")) return "official";
  if (domain.includes("retailer") || domain.includes("shop") || domain.includes("store")) return "retailer";
  if (domain.includes("review") || domain.includes("tech") || domain.includes("blog")) return "review";
  return "other";
}

function sourceTypeToDiscovered(sourceType: ProductSource["type"]): DiscoveredImage["sourceType"] {
  switch (sourceType) {
    case "official":
      return "manufacturer";
    case "retailer":
      return "retailer";
    default:
      return "other";
  }
}

export async function discoverProductImages(
  productName: string,
  brand: string
): Promise<{ images: DiscoveredImage[]; status: "success" | "failed" | "skipped"; error?: string }> {
  if (!env.SEARCH_API_KEY || !env.SEARCH_API_URL) {
    return {
      images: [],
      status: "skipped",
      error: "Online image discovery is currently unavailable. No search provider is configured.",
    };
  }

  try {
    const query = `${brand} ${productName} product image official`;
    const searchResult = await searchWeb(query);

    if (searchResult.status !== "success") {
      return { images: [], status: "failed", error: searchResult.error };
    }

    const imageUrls: DiscoveredImage[] = [];
    for (const source of searchResult.results.slice(0, 5)) {
      try {
        const pageResponse = await fetch(source.url, {
          headers: { "User-Agent": "ShopNest-ImageDiscovery/1.0" },
          signal: AbortSignal.timeout(5000),
        });

        if (!pageResponse.ok) continue;

        const html = await pageResponse.text();
        const imageMatches = html.match(/https?:\/\/[^"'<>]+\.(jpg|jpeg|png|webp)/gi) || [];
        const productImages = imageMatches.filter((url) => {
          const lower = url.toLowerCase();
          return !lower.includes("logo") && !lower.includes("icon") && !lower.includes("banner") && !lower.includes("sprite");
        }).slice(0, 3);

        for (const imgUrl of productImages) {
          imageUrls.push({
            url: imgUrl,
            sourceUrl: source.url,
            sourceType: sourceTypeToDiscovered(source.type),
            licenseStatus: "unknown",
          });
        }
      } catch {
        // Skip failed pages
      }
    }

    return { images: imageUrls.slice(0, 8), status: "success" };
  } catch (error) {
    logger.error("Image discovery failed", { error });
    return {
      images: [],
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown image discovery error",
    };
  }
}

export async function generateProductImage(
  productDescription: string,
  existingImageUrls: string[]
): Promise<{ imageUrl: string | null; status: "success" | "failed" | "skipped"; error?: string }> {
  if (!env.IMAGE_GENERATION_API_KEY || !env.IMAGE_GENERATION_API_URL) {
    return {
      imageUrl: null,
      status: "skipped",
      error: "AI image generation is currently unavailable. No image generation provider is configured.",
    };
  }

  try {
    const apiUrl = env.IMAGE_GENERATION_API_URL;
    const apiKey = env.IMAGE_GENERATION_API_KEY;
    const prompt = `Professional e-commerce product photo of ${productDescription}. Clean white background, studio lighting, product centered, high quality, commercial photography style.`;

    let response: Response;
    if (apiUrl.includes("openai.com")) {
      response = await fetch(`${apiUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
        }),
      });
    } else if (apiUrl.includes("stability.ai") || apiUrl.includes("stabilityai")) {
      response = await fetch(`${apiUrl}/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt }],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          steps: 30,
          samples: 1,
        }),
      });
    } else {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          size: "1024x1024",
          quality: "standard",
          n: 1,
        }),
      });
    }

    if (!response.ok) {
      return {
        imageUrl: null,
        status: "failed",
        error: `Image generation service returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { data?: Array<{ url?: string }>; output?: { url?: string } };
    const imageUrl = data?.data?.[0]?.url || data?.output?.url || null;

    if (!imageUrl) {
      return {
        imageUrl: null,
        status: "failed",
        error: "Image generation response did not contain an image URL",
      };
    }

    return { imageUrl, status: "success" };
  } catch (error) {
    logger.error("Image generation failed", { error });
    return {
      imageUrl: null,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown image generation error",
    };
  }
}
