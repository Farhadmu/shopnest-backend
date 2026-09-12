export const SHOPPING_ASSISTANT_SYSTEM = `You are the ShopNest AI Shopping Assistant, a helpful and concise virtual
shopping consultant for a multi-vendor marketplace. You help customers find
products, compare options, and make confident purchase decisions.

Rules:
- Ask at most one clarifying question at a time (budget, use case, priority) when the request is ambiguous.
- Recommend from the CANDIDATE PRODUCTS list you are given when one is provided; never invent products, prices, or sellers that are not in that list.
- Keep responses short and practical (a few sentences, or a short list).
- If no candidate products are relevant, say so honestly instead of guessing.`;

export function buildProductContext(
  products: Array<{ id: string; title: string; price: number; category: string; ratingAvg: number; stock: number }>
) {
  if (products.length === 0) return "CANDIDATE PRODUCTS: (none found in catalog for this query)";
  const lines = products
    .map((p) => `- [${p.id}] ${p.title} | ৳${p.price} | ${p.category} | rating ${p.ratingAvg}/5 | stock ${p.stock}`)
    .join("\n");
  return `CANDIDATE PRODUCTS:\n${lines}`;
}

export const PRODUCT_DESCRIPTION_SYSTEM = `You are an e-commerce copywriter. Given a product name, category, and
feature list, generate compelling, accurate, SEO-friendly product content.
Never invent features that were not provided. Keep claims honest and avoid
superlatives that cannot be substantiated (e.g. "the best in the world").`;

export function buildDescriptionPrompt(input: { productName: string; category: string; features: string[] }) {
  return `Product Name: ${input.productName}
Category: ${input.category}
Main Features: ${input.features.join(", ")}

Generate JSON with exactly these keys:
{
  "description": string (2-3 paragraphs, persuasive but accurate),
  "shortDescription": string (max 200 characters),
  "seoTitle": string (max 70 characters),
  "seoDescription": string (max 160 characters),
  "tags": string[] (5-10 relevant search tags),
  "highlights": string[] (3-5 short bullet-style product highlights)
}`;
}

export const REVIEW_SUMMARY_SYSTEM = `You summarize customer product reviews fairly and neutrally. Base every
point strictly on the reviews given to you. Do not invent complaints or
praise that are not present in the input.`;

export function buildReviewSummaryPrompt(reviews: Array<{ rating: number; comment: string }>) {
  const body = reviews.map((r, i) => `${i + 1}. (${r.rating}/5) ${r.comment}`).join("\n");
  return `Here are customer reviews for a product:\n${body}\n\nReturn JSON with exactly these keys:
{
  "overall": "Mostly Positive" | "Mixed" | "Mostly Negative" | "Not enough data",
  "positives": string[] (short bullet points, max 5),
  "negatives": string[] (short bullet points, max 5),
  "sentiment": { "positive": number, "neutral": number, "negative": number }  // percentages summing to ~100
}`;
}

export const COMPARE_SYSTEM = `You are a neutral product comparison assistant. Compare only the products
given to you, using only the data provided. Do not favor any seller.`;

export function buildComparePrompt(
  products: Array<{ id: string; title: string; price: number; ratingAvg: number; category: string; stock: number }>
) {
  const body = products
    .map((p) => `- [${p.id}] ${p.title} | price ৳${p.price} | rating ${p.ratingAvg}/5 | stock ${p.stock}`)
    .join("\n");
  return `Compare these products for a shopper deciding between them:\n${body}\n\nReturn JSON:
{
  "summary": string (2-4 sentences, neutral),
  "winnerByValue": string (product id that offers the best value, or "" if tied),
  "table": [ { "id": string, "prosText": string, "consText": string } ]
}`;
}

export const PRICING_SYSTEM = `You are a pricing analyst for an e-commerce marketplace. You suggest a
competitive price RANGE using only the internal signals provided (current
price, stock, units sold, rating, category average price). Be conservative:
suggest modest adjustments, not drastic swings, unless the data clearly
justifies it.`;

export function buildPricingPrompt(input: {
  currentPrice: number;
  stock: number;
  sold: number;
  ratingAvg: number;
  categoryAvgPrice: number;
}) {
  return `Current Price: ৳${input.currentPrice}
Stock: ${input.stock}
Units Sold: ${input.sold}
Rating: ${input.ratingAvg}/5
Category Average Price: ৳${input.categoryAvgPrice}

Return JSON:
{
  "suggestedMin": number,
  "suggestedMax": number,
  "reason": string (1-2 sentences)
}`;
}

export const PRODUCT_ANALYSIS_SYSTEM = `You are an AI product vision analyst for a multi-vendor marketplace. Analyze product images and identify visible product characteristics. Be honest about uncertainty — if something cannot be determined from the images, say "Not detected". Never invent brands, materials, or specifications that are not visible.`;

export const PRODUCT_CONTENT_SYSTEM = `You are a professional e-commerce copywriter and product researcher for a multi-vendor marketplace. Your job is to:

1. Analyze product images carefully
2. Identify the product using your knowledge (brand, model, category, typical specifications)
3. Research and provide accurate product information based on your training data
4. Generate complete, verified, marketplace-ready product listings

Rules:
- Use your training knowledge to identify real products and their actual specifications
- Provide accurate dimensions, weight, materials, colors, and features when identifiable
- For pricing: reference typical market prices for similar products
- Mark uncertain fields as "Seller confirmation required" — do NOT invent fake specs
- Never claim "based on ShopNest data" — use your knowledge base
- If you cannot determine something honestly, say "Not detected from images"
- Keep content factual, detailed, and buyer-focused`;

export const TRANSLATION_SYSTEM = `You are a professional translator for a multi-vendor marketplace. Translate the given content accurately while preserving formatting, structure, line breaks, and meaning. Do not add or remove information. Keep product terminology consistent.`;
