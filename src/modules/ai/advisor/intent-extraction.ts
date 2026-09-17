/**
 * Context-Aware Intent Extraction for Conversational AI
 * 
 * Extracts user intent considering conversation history and current state,
 * not just keyword matching.
 */

import { ConversationState, TopicType, IntentType } from "./conversation-state";

export interface ExtractedIntent {
  intent: IntentType;
  topic: TopicType | null;
  confidence: number;
  requiresClarification: boolean;
  clarificationQuestion: string | null;
  extractedEntities: ExtractedEntities;
}

export interface ExtractedEntities {
  // Product search entities
  category: string | null;
  budgetMax: number | null;
  budgetMin: number | null;
  useCase: string | null;
  features: string[];
  brands: string[];
  excludedBrands: string[];
  
  // Modification entities
  budgetChange: "increase" | "decrease" | null;
  priorityChanges: string[];
  
  // Reference entities
  productReference: ProductReference | null;
  orderReference: OrderReference | null;
  
  // Language detection
  detectedLanguage: "en" | "bn" | "mixed";
}

export interface ProductReference {
  type: "ordinal" | "brand" | "price" | "previous";
  value: string | number;
  rawText: string;
}

export interface OrderReference {
  type: "latest" | "ordinal" | "status";
  value: string | number;
  rawText: string;
}

/**
 * Extract intent from message considering conversation context
 */
export function extractIntent(
  message: string,
  conversationState: ConversationState,
  conversationHistory: Array<{ role: string; content: string }>
): ExtractedIntent {
  const lower = message.toLowerCase();
  const entities = extractEntities(message, conversationState);
  
  // Detect language first
  const hasEnglish = /[a-zA-Z]/.test(message);
  const hasBangla = /[\u0980-\u09FF]/.test(message);
  entities.detectedLanguage = hasBangla && hasEnglish ? "mixed" : hasBangla ? "bn" : "en";
  
  // Check for greetings
  if (isGreeting(message) && conversationHistory.length <= 2) {
    return {
      intent: "greeting",
      topic: "general_chat",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }

  // General conversation — never force product search
  if (isGeneralConversation(message)) {
    return {
      intent: conversationHistory.length > 2 ? "followup" : "browse",
      topic: "general_chat",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Comparison before pronoun resolution so "which one is better?" compares
  // the shown set instead of collapsing into a single-product followup.
  if (isComparisonIntent(message) && conversationState.referencedProducts.length >= 2) {
    return {
      intent: "compare",
      topic: "product_comparison",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }

  // "anything cheaper?" is a requirement change, not a pointer to the cheapest card.
  if (wantsCheaperAlternatives(message) && conversationState.productContext) {
    entities.budgetChange = entities.budgetChange || "decrease";
    return {
      intent: "modify_requirements",
      topic: conversationState.currentTopic || "product_search",
      confidence: 0.85,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }

  // Check for reference to previous products/orders
  if (hasProductReference(message)) {
    entities.productReference = extractProductReference(message);
    
    if (conversationState.referencedProducts.length > 0) {
      // User is asking about a previously mentioned product
      return {
        intent: "followup",
        topic: conversationState.currentTopic || "product_search",
        confidence: 0.85,
        requiresClarification: false,
        clarificationQuestion: null,
        extractedEntities: entities,
      };
    }
  }
  
  // Clarifying-turn answers: "programming", "80k", "battery valo chai"
  // after an earlier product ask must enrich state — not restart as general chat.
  if (
    conversationState.conversationPhase === "clarifying" &&
    conversationState.productContext?.category &&
    (entities.useCase || entities.budgetMax || entities.features.length > 0 || entities.priorityChanges.length > 0)
  ) {
    const mergedUseCase = entities.useCase || conversationState.productContext.useCase;
    const mergedBudget = entities.budgetMax || conversationState.productContext.budgetMax;
    const stillNeedsClarification = !mergedUseCase && !mergedBudget;
    return {
      intent: "recommend",
      topic: "product_search",
      confidence: 0.9,
      requiresClarification: stillNeedsClarification,
      clarificationQuestion: stillNeedsClarification
        ? determineClarificationQuestion(
            { ...entities, category: conversationState.productContext.category },
            conversationState
          )
        : null,
      extractedEntities: entities,
    };
  }

  // Check for modification intent
  if (isModificationIntent(message, conversationState)) {
    return {
      intent: "modify_requirements",
      topic: conversationState.currentTopic || "product_search",
      confidence: 0.8,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Check for topic switch
  const newTopic = detectTopic(message, conversationState);
  const isSwitching = conversationState.currentTopic && 
    newTopic && 
    newTopic !== conversationState.currentTopic &&
    !areRelatedTopics(conversationState.currentTopic, newTopic);
  
  if (isSwitching) {
    return {
      intent: isProductSearchTopic(newTopic) ? "recommend" : "check_status",
      topic: newTopic,
      confidence: 0.75,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Product search intents
  if (isProductSearchIntent(message)) {
    const topic = newTopic || "product_search";
    const mergedCategory = entities.category || conversationState.productContext?.category;
    const mergedUseCase = entities.useCase || conversationState.productContext?.useCase;
    const mergedBudget = entities.budgetMax || conversationState.productContext?.budgetMax;
    const hasPriorities =
      entities.features.length > 0 ||
      entities.priorityChanges.length > 0 ||
      (conversationState.productContext?.priorities.length || 0) > 0;

    // Ask before searching when category is known but use-case/budget are still missing.
    // Example: "laptop lagbe" / "amar laptop lagbe" → clarify use, do NOT dump products.
    const wantsImmediateResults = wantsCatalogResults(message);

    if (!mergedCategory) {
      return {
        intent: "recommend",
        topic,
        confidence: 0.7,
        requiresClarification: true,
        clarificationQuestion: determineClarificationQuestion(entities, conversationState),
        extractedEntities: entities,
      };
    }

    if (!wantsImmediateResults && (!mergedUseCase || !mergedBudget) && !hasPriorities) {
      return {
        intent: "recommend",
        topic,
        confidence: 0.8,
        requiresClarification: true,
        clarificationQuestion: determineClarificationQuestion(
          {
            ...entities,
            category: mergedCategory ?? null,
            useCase: mergedUseCase ?? null,
            budgetMax: mergedBudget ?? null,
          },
          conversationState
        ),
        extractedEntities: entities,
      };
    }

    if (!wantsImmediateResults && !mergedUseCase && !mergedBudget) {
      return {
        intent: "recommend",
        topic,
        confidence: 0.8,
        requiresClarification: true,
        clarificationQuestion: determineClarificationQuestion(
          { ...entities, category: mergedCategory },
          conversationState
        ),
        extractedEntities: entities,
      };
    }
    
    return {
      intent: "recommend",
      topic,
      confidence: 0.85,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Comparison intent
  if (isComparisonIntent(message)) {
    return {
      intent: "compare",
      topic: "product_comparison",
      confidence: 0.85,
      requiresClarification: conversationState.referencedProducts.length < 2,
      clarificationQuestion: conversationState.referencedProducts.length < 2 
        ? "Which products would you like me to compare?"
        : null,
      extractedEntities: entities,
    };
  }
  
  // Order/delivery tracking
  if (isOrderInquiry(message)) {
    return {
      intent: "check_status",
      topic: "order_inquiry",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  if (isDeliveryInquiry(message)) {
    return {
      intent: "check_status",
      topic: "delivery_tracking",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Platform help
  if (isPlatformQuestion(message)) {
    return {
      intent: "learn_platform",
      topic: "platform_help",
      confidence: 0.8,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Navigation intent
  if (isNavigationIntent(message)) {
    return {
      intent: "navigate",
      topic: "navigation",
      confidence: 0.75,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Wishlist/Cart
  if (isWishlistIntent(message)) {
    return {
      intent: "check_status",
      topic: "wishlist",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  if (isCartIntent(message)) {
    return {
      intent: "check_status",
      topic: "cart",
      confidence: 0.9,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Return inquiry
  if (isReturnInquiry(message)) {
    return {
      intent: "check_status",
      topic: "return_inquiry",
      confidence: 0.85,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Seller inquiry
  if (isSellerInquiry(message)) {
    return {
      intent: "check_status",
      topic: "seller_inquiry",
      confidence: 0.8,
      requiresClarification: false,
      clarificationQuestion: null,
      extractedEntities: entities,
    };
  }
  
  // Default: general chat / followup
  return {
    intent: conversationHistory.length > 2 ? "followup" : "browse",
    topic: conversationState.currentTopic || "general_chat",
    confidence: 0.5,
    requiresClarification: false,
    clarificationQuestion: null,
    extractedEntities: entities,
  };
}

/**
 * Extract entities from message
 */
function extractEntities(message: string, state: ConversationState): ExtractedEntities {
  const lower = message.toLowerCase();
  
  return {
    category: extractCategory(message),
    budgetMax: extractBudgetMax(message),
    budgetMin: extractBudgetMin(message),
    useCase: extractUseCase(message),
    features: extractFeatures(message),
    brands: extractBrands(message),
    excludedBrands: extractExcludedBrands(message),
    budgetChange: detectBudgetChange(message, state),
    priorityChanges: extractPriorityChanges(message),
    productReference: null,
    orderReference: null,
    detectedLanguage: "en",
  };
}

function extractCategory(message: string): string | null {
  const lower = message.toLowerCase();

  // Product-type keywords first — these are search terms, not broad DB categories.
  // Mapping laptop → "Computers & Accessories" previously pulled graphics cards,
  // desktops, and PC games into laptop results.
  const productTypeMap: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /\b(?:laptop|notebook|macbook|ল্যাপটপ)\b/i, category: "laptop" },
    { pattern: /\b(?:headphone|headphones|earphone|earphones|earbud|earbuds|হেডফোন)\b/i, category: "headphone" },
    { pattern: /\b(?:smartphone|mobile\s*phone|phone|মোবাইল|ফোন)\b/i, category: "phone" },
    { pattern: /\b(?:tablet|ipad)\b/i, category: "tablet" },
    { pattern: /\b(?:desktop|pc\s*build)\b/i, category: "desktop" },
    { pattern: /\b(?:monitor|display)\b/i, category: "monitor" },
    { pattern: /\b(?:keyboard)\b/i, category: "keyboard" },
    { pattern: /\b(?:mouse)\b/i, category: "mouse" },
    { pattern: /\b(?:speaker|soundbox)\b/i, category: "speaker" },
    { pattern: /\b(?:smartwatch|watch)\b/i, category: "watch" },
    { pattern: /\b(?:shirt|pant|dress|saree|panjabi|bag|wallet)\b/i, category: "fashion" },
  ];

  for (const entry of productTypeMap) {
    if (entry.pattern.test(lower)) {
      return entry.category;
    }
  }

  return null;
}

function normalizeBanglaDigits(text: string): string {
  const map: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };
  return text.replace(/[০-৯]/g, (digit) => map[digit] || digit);
}

function extractBudgetMax(message: string): number | null {
  const lower = normalizeBanglaDigits(message).toLowerCase();

  const thousandMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:k|হাজার|hazar|thousand)\b/i);
  if (thousandMatch) {
    return Math.round(parseFloat(thousandMatch[1]) * 1000);
  }

  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|লাখ)\b/i);
  if (lakhMatch) {
    return Math.round(parseFloat(lakhMatch[1]) * 100000);
  }
  
  const patterns = [
    /(?:under|below|budget|within|max|niche|moddhe|vitor|kom)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i,
    /(?:tk|taka|৳)\s*(\d+[\d,]*)\s*(?:under|below|niche|moddhe)/i,
    /(\d+[\d,]*)\s*(?:tk|taka|৳)\s*(?:er\s+)?(?:niche|moddhe|vitor|kom)/i,
    /(\d+[\d,]*)\s*(?:er\s+)?(?:moddhe|niche|vitor)/i,
  ];
  
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      return Number(match[1].replace(/,/g, ""));
    }
  }
  
  return null;
}

function extractBudgetMin(message: string): number | null {
  const lower = message.toLowerCase();
  
  const minMatch = lower.match(/(?:above|more than|at least|min|theke|from)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i);
  if (minMatch) {
    return Number(minMatch[1].replace(/,/g, ""));
  }
  
  return null;
}

function extractUseCase(message: string): string | null {
  const lower = message.toLowerCase();

  const useCaseMap: Array<{ pattern: RegExp; useCase: string }> = [
    { pattern: /\b(?:programming|coding|developer|software|কোডিং|প্রোগ্রামিং)\b/i, useCase: "programming" },
    { pattern: /\b(?:gaming|game|গেমিং)\b/i, useCase: "gaming" },
    { pattern: /\b(?:office|business|work)\b/i, useCase: "office" },
    { pattern: /\b(?:student|study|পড়াশোনা|পড়ার)\b/i, useCase: "study" },
    { pattern: /\b(?:photography|photo|camera)\b/i, useCase: "photography" },
    { pattern: /\b(?:video|editing)\b/i, useCase: "video editing" },
    { pattern: /\b(?:music|audio)\b/i, useCase: "music" },
    { pattern: /\b(?:general\s*use|daily\s*use)\b/i, useCase: "general" },
  ];

  for (const entry of useCaseMap) {
    if (entry.pattern.test(lower)) {
      return entry.useCase;
    }
  }

  return null;
}

function extractFeatures(message: string): string[] {
  const lower = message.toLowerCase();
  const features: string[] = [];
  
  const featureKeywords = [
    "battery", "16gb", "32gb", "ssd", "ram", "gpu", "display",
    "wireless", "bluetooth", "wifi", "5g", "camera", "fast charging",
    "warranty", "free delivery", "waterproof",
  ];
  
  for (const feature of featureKeywords) {
    if (lower.includes(feature)) {
      features.push(feature);
    }
  }
  
  return features;
}

function extractBrands(message: string): string[] {
  const brands: string[] = [];
  const words = message.split(/\s+/);
  
  const knownBrands = [
    "Apple", "Samsung", "Lenovo", "HP", "Dell", "Asus", "Acer",
    "Sony", "LG", "Xiaomi", "Oppo", "Vivo", "Realme", "OnePlus",
    "JBL", "Bose", "Anker",
  ];
  
  for (const word of words) {
    const capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (knownBrands.includes(capitalized)) {
      brands.push(capitalized);
    }
  }
  
  return brands;
}

function extractExcludedBrands(message: string): string[] {
  const lower = message.toLowerCase();
  const excluded: string[] = [];
  
  if (lower.includes("not ") || lower.includes("except ") || lower.includes("without ")) {
    const brands = extractBrands(message);
    excluded.push(...brands);
  }
  
  return excluded;
}

function detectBudgetChange(message: string, state: ConversationState): "increase" | "decrease" | null {
  const lower = message.toLowerCase();
  
  if (!state.productContext?.budgetMax) return null;
  
  if (lower.includes("cheap") || lower.includes("lower") || lower.includes("kom") || lower.includes("reduce")) {
    return "decrease";
  }
  
  if (lower.includes("expensive") || lower.includes("higher") || lower.includes("beshi") || lower.includes("increase")) {
    return "increase";
  }
  
  const newBudget = extractBudgetMax(message);
  if (newBudget && newBudget !== state.productContext.budgetMax) {
    return newBudget < state.productContext.budgetMax ? "decrease" : "increase";
  }
  
  return null;
}

function extractPriorityChanges(message: string): string[] {
  const lower = message.toLowerCase();
  const priorities: string[] = [];
  
  if (
    /important|priority|focus|valo chai|ভালো চাই|better|must have|beshi important/i.test(lower)
  ) {
    const features = extractFeatures(message);
    priorities.push(...features);
  }
  
  return priorities;
}

function extractProductReference(message: string): ProductReference | null {
  const lower = message.toLowerCase();
  
  // Ordinal references
  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
  };
  
  for (const [word, position] of Object.entries(ordinals)) {
    if (lower.includes(word)) {
      return { type: "ordinal", value: position, rawText: word };
    }
  }
  
  // "that one", "this one"
  if (lower.includes("that one") || lower.includes("this one")) {
    return { type: "previous", value: "last", rawText: "that one" };
  }
  
  // "cheaper one", "expensive one"
  if (lower.includes("cheap")) {
    return { type: "price", value: "min", rawText: "cheaper" };
  }
  if (lower.includes("expensive") || lower.includes("pricey")) {
    return { type: "price", value: "max", rawText: "expensive" };
  }
  
  // Brand references (will be resolved later)
  const brands = extractBrands(message);
  if (brands.length > 0) {
    return { type: "brand", value: brands[0], rawText: brands[0] };
  }
  
  return null;
}

function hasProductReference(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(first|second|third|1st|2nd|3rd|that one|this one|the previous one|eta|oitake|2nd tar|which one|the cheaper one|the expensive one)\b/i.test(lower)
    || /\b(?:how much is it|does it have|warranty ache|eta ki)\b/i.test(lower);
}

function wantsCatalogResults(message: string): boolean {
  return /\b(show me|show options|some options|dekhao|dekhao na|khujchi|recommend now|find options)\b/i.test(message);
}

function wantsCheaperAlternatives(message: string): boolean {
  return /\b(anything cheaper|cheaper options|aro kom|cheaper|kom budget|lower budget)\b/i.test(message)
    && !/\b(the cheaper one|cheaper one)\b/i.test(message);
}

function isGreeting(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(hello|hi|hey|hlw|hii|hlo|yo|good\s*morning|good\s*evening|good\s*afternoon|salam|assalamualaikum|assalamu\s*alaikum|হাই|হ্যালো|কেমন|কেমন আছো|কি খবর|bhai|vai|kemon|kemon acho|ki khobor)\s*[?!.💕👋]*$/i.test(trimmed);
}

function isModificationIntent(message: string, state: ConversationState): boolean {
  if (!state.productContext) return false;
  
  const lower = message.toLowerCase();
  return (
    lower.includes("make it") ||
    lower.includes("change") ||
    lower.includes("instead") ||
    lower.includes("actually") ||
    detectBudgetChange(message, state) !== null ||
    extractPriorityChanges(message).length > 0
  );
}

function isProductSearchTopic(topic: TopicType): boolean {
  return topic === "product_search" || topic === "product_comparison";
}

function detectTopic(message: string, state: ConversationState): TopicType | null {
  const lower = message.toLowerCase();

  if (/\b(forget|actually forget|na headphone|instead|switch to)\b/i.test(lower) && !extractCategory(message)) {
    return "general_chat";
  }
  
  if (extractCategory(message)) return "product_search";
  if (/\b(find|search|show|looking for|need|want|recommend|lagbe|chai|dekhao)\b/i.test(lower)) return "product_search";
  if (/\b(compare|comparison|versus|vs|which is better)\b/i.test(lower)) return "product_comparison";
  if (/\b(order|orders|track order|where is my order)\b/i.test(lower)) return "order_inquiry";
  if (/\b(delivery|shipping|courier|rider)\b/i.test(lower) && !/\bhow does delivery\b/i.test(lower)) return "delivery_tracking";
  if (/\b(wishlist|saved)\b/i.test(lower) && !/\bhow (do i|to)\b/i.test(lower)) return "wishlist";
  if (/\b(cart|checkout)\b/i.test(lower) && !/\bhow (do i|to)\b/i.test(lower)) return "cart";
  if (/\b(return|exchange|refund)\b/i.test(lower) && !/\bhow (do|does)\b/i.test(lower)) return "return_inquiry";
  if (/\b(seller|store)\b/i.test(lower) && !/\bbecome a seller|how (do i|to)\b/i.test(lower)) return "seller_inquiry";
  if (/\b(how do|how to|what is|explain|kivabe)\b/i.test(lower)) return "platform_help";
  if (/\b(go to|navigate|take me|show me where)\b/i.test(lower)) return "navigation";
  
  return null;
}

function areRelatedTopics(topic1: TopicType, topic2: TopicType): boolean {
  const related: Record<TopicType, TopicType[]> = {
    product_search: ["product_comparison"],
    product_comparison: ["product_search"],
    order_inquiry: ["delivery_tracking", "return_inquiry"],
    delivery_tracking: ["order_inquiry"],
    return_inquiry: ["order_inquiry"],
    wishlist: ["product_search"],
    cart: ["product_search"],
    seller_inquiry: ["product_search"],
    platform_help: [],
    general_chat: [],
    navigation: [],
  };
  
  return related[topic1]?.includes(topic2) || false;
}

function isProductSearchIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\b(find|search|show|looking for|need|want|recommend|suggest|lagbe|chai|dekhao|khojo|dekhaw)\b/i.test(lower) ||
    /\b(laptop|notebook|phone|headphone|headphones|earphone|earbuds|mouse|keyboard|monitor|watch|bag|shirt)\b/i.test(lower) ||
    /\b(under|below|budget|moddhe|niche)\b/i.test(lower)
  );
}

function isComparisonIntent(message: string): boolean {
  return /\b(compare|comparison|versus|vs|which is better|difference|better option)\b/i.test(message.toLowerCase());
}

function isOrderInquiry(message: string): boolean {
  return /\b(order|orders|order status|my order|amar order|order koi|order kobe)\b/i.test(message.toLowerCase());
}

function isDeliveryInquiry(message: string): boolean {
  return /\b(delivery|shipping|track|courier|rider|where is my delivery)\b/i.test(message.toLowerCase());
}

function isPlatformQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();
  // Avoid treating casual chat ("how are you?", "kemon acho") as platform help
  if (/^(how are you|how r you|how's it going|kemon acho|kemon aso)\b/i.test(lower)) {
    return false;
  }
  return (
    /\b(how do i|how to|what is shopnest|how does|how can i|explain|tell me about|kivabe|shopnest)\b/i.test(lower) ||
    /\b(return policy|delivery|order|wishlist|cart|become a seller|track)\b/i.test(lower)
  );
}

function isGeneralConversation(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return (
    /^(how are you|how r you|how's it going|kemon acho|kemon aso|ki khobor)\b/i.test(lower) ||
    /^(what can you do|what do you do|help me|thanks|thank you|ok|okay|thik ache|dhonnobad)\b/i.test(lower) ||
    /\b(what can you help|capabilities|who are you)\b/i.test(lower)
  );
}

function isNavigationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(navigate|go to|take me to|open|where is|show me where|kothay)\b/i.test(lower) && 
    !/\b(product|laptop|phone|headphone)\b/i.test(lower);
}

function isWishlistIntent(message: string): boolean {
  return /\b(wishlist|saved items|saved products|my wishlist|amar wishlist)\b/i.test(message.toLowerCase());
}

function isCartIntent(message: string): boolean {
  return /\b(cart|my cart|in my cart|checkout)\b/i.test(message.toLowerCase());
}

function isReturnInquiry(message: string): boolean {
  return /\b(return|exchange|return policy|refund)\b/i.test(message.toLowerCase());
}

function isSellerInquiry(message: string): boolean {
  return /\b(seller|store|about this seller|seller info)\b/i.test(message.toLowerCase());
}

function determineClarificationQuestion(
  entities: ExtractedEntities,
  state: ConversationState
): string | null {
  const category = entities.category || state.productContext?.category;
  const useCase = entities.useCase || state.productContext?.useCase;
  const budgetMax = entities.budgetMax || state.productContext?.budgetMax;
  const isBn = entities.detectedLanguage === "bn" || entities.detectedLanguage === "mixed";

  if (!category) {
    return isBn
      ? "কী ধরনের পণ্য খুঁজছেন? (laptop, phone, headphone, etc.)"
      : "What type of product are you looking for?";
  }

  // Prefer use-case clarification first for laptop-like product discovery
  if (!useCase) {
    if (category === "laptop" || category === "desktop" || category === "pc") {
      return isBn
        ? "Sure! 😊 Ki jonno use korben — programming, gaming, study, naki general use?"
        : "Sure 😄 Mainly programming, gaming, study, or general use?";
    }
    return isBn
      ? "মূলত কী কাজে ব্যবহার করবেন?"
      : "What will you mainly use it for?";
  }

  if (!budgetMax) {
    return isBn ? "Got it. Budget roughly koto?" : "Got it. What's your rough budget?";
  }

  return null;
}
