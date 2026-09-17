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
    
    // Check if we have enough information
    if (!entities.category && !conversationState.productContext?.category) {
      return {
        intent: "recommend",
        topic,
        confidence: 0.7,
        requiresClarification: true,
        clarificationQuestion: determineClarificationQuestion(entities, conversationState),
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
  
  const categoryMap: Record<string, string> = {
    laptop: "Computers & Accessories",
    computer: "Computers & Accessories",
    pc: "Computers & Accessories",
    macbook: "Computers & Accessories",
    phone: "Phones & Tablets",
    mobile: "Phones & Tablets",
    smartphone: "Phones & Tablets",
    tablet: "Phones & Tablets",
    headphone: "Electronics & Gadgets",
    earphone: "Electronics & Gadgets",
    earbud: "Electronics & Gadgets",
    speaker: "Electronics & Gadgets",
    soundbox: "Electronics & Gadgets",
    mouse: "Electronics & Gadgets",
    keyboard: "Electronics & Gadgets",
    monitor: "Electronics & Gadgets",
    watch: "Fashion & Clothing",
    smartwatch: "Fashion & Clothing",
    shirt: "Fashion & Clothing",
    pant: "Fashion & Clothing",
    dress: "Fashion & Clothing",
    saree: "Fashion & Clothing",
    panjabi: "Fashion & Clothing",
    bag: "Fashion & Clothing",
    wallet: "Fashion & Clothing",
  };
  
  for (const [keyword, category] of Object.entries(categoryMap)) {
    if (lower.includes(keyword)) {
      return category;
    }
  }
  
  return null;
}

function extractBudgetMax(message: string): number | null {
  const lower = message.toLowerCase();
  
  // "80k" format
  const kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }
  
  // "under 80000", "below 50k", "৮০ হাজার"
  const patterns = [
    /(?:under|below|budget|within|max|niche|moddhe|vitor|kom)\s*(?:tk|taka|৳)?\s*(\d+[\d,]*)/i,
    /(?:tk|taka|৳)\s*(\d+[\d,]*)\s*(?:under|below|niche|moddhe)/i,
    /(\d+[\d,]*)\s*(?:tk|taka|৳)\s*(?:er\s+)?(?:niche|moddhe|vitor|kom)/i,
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
  
  const useCases = [
    "programming", "coding", "developer", "software",
    "gaming", "game",
    "office", "business", "work",
    "student", "study",
    "photography", "photo", "camera",
    "video", "editing",
    "music", "audio",
  ];
  
  for (const useCase of useCases) {
    if (lower.includes(useCase)) {
      return useCase;
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
  
  if (lower.includes("important") || lower.includes("priority") || lower.includes("focus")) {
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
  return /\b(first|second|third|1st|2nd|3rd|that one|this one|it|which one|cheaper|expensive)\b/i.test(lower);
}

function isGreeting(message: string): boolean {
  const lower = message.toLowerCase();
  return /^(hello|hi|hey|good morning|good evening|salam|assalamualaikum|bhai|vai|kemon|kemon acho|ki khobor)\s*[?!.]*$/i.test(lower.trim());
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
  
  if (extractCategory(message)) return "product_search";
  if (/\b(find|search|show|looking for|need|want|recommend|lagbe|chai|dekhao)\b/i.test(lower)) return "product_search";
  if (/\b(compare|comparison|versus|vs|which is better)\b/i.test(lower)) return "product_comparison";
  if (/\b(order|orders|track order|where is my order)\b/i.test(lower)) return "order_inquiry";
  if (/\b(delivery|shipping|courier|rider)\b/i.test(lower)) return "delivery_tracking";
  if (/\b(wishlist|saved)\b/i.test(lower)) return "wishlist";
  if (/\b(cart|checkout)\b/i.test(lower)) return "cart";
  if (/\b(return|exchange|refund)\b/i.test(lower)) return "return_inquiry";
  if (/\b(seller|store)\b/i.test(lower)) return "seller_inquiry";
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
    /\b(find|search|show|looking for|need|want|recommend|suggest|lagbe|chai|dekhao|khojo)\b/i.test(lower) ||
    /\b(laptop|phone|headphone|mouse|keyboard|monitor|watch|bag|shirt)\b/i.test(lower) ||
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
  return /\b(how do|how to|what is|how does|how can|explain|tell me about|kivabe|kemon|shopnest)\b/i.test(message.toLowerCase());
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
  // Check what's missing
  if (!entities.category && !state.productContext?.category) {
    if (entities.detectedLanguage === "bn" || entities.detectedLanguage === "mixed") {
      return "কী ধরনের পণ্য খুঁজছেন? (laptop, phone, headphone, etc.)";
    }
    return "What type of product are you looking for?";
  }
  
  if (!entities.budgetMax && !state.productContext?.budgetMax && entities.category) {
    if (entities.detectedLanguage === "bn" || entities.detectedLanguage === "mixed") {
      return "আপনার budget কত?";
    }
    return "What's your budget?";
  }
  
  if (!entities.useCase && !state.productContext?.useCase && entities.category) {
    if (entities.detectedLanguage === "bn" || entities.detectedLanguage === "mixed") {
      return "মূলত কী কাজে ব্যবহার করবেন?";
    }
    return "What will you mainly use it for?";
  }
  
  return null;
}
