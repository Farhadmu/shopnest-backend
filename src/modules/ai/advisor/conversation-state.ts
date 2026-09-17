/**
 * Conversational State Management for ShopNest AI Advisor
 * 
 * This module provides structured conversation context that persists across multiple turns,
 * enabling the AI to maintain coherent multi-turn conversations with reference resolution,
 * topic switching detection, and requirement tracking.
 */

export interface ConversationState {
  // Primary intent and topic
  currentTopic: TopicType | null;
  currentIntent: IntentType | null;
  
  // Product search context
  productContext: ProductSearchContext | null;
  
  // Referenced entities (for "the second one", "that laptop")
  referencedProducts: ReferencedProduct[];
  referencedOrders: ReferencedOrder[];
  
  // Conversation flow
  conversationPhase: ConversationPhase;
  pendingClarification: string | null;
  
  // User preferences learned during conversation
  userPreferences: UserPreferences;
  
  // Topic history for detecting switches
  topicHistory: Array<{ topic: TopicType; turn: number }>;
  
  // Last update turn
  lastUpdateTurn: number;
}

export type TopicType = 
  | "product_search"
  | "product_comparison"
  | "order_inquiry"
  | "delivery_tracking"
  | "wishlist"
  | "cart"
  | "return_inquiry"
  | "platform_help"
  | "seller_inquiry"
  | "general_chat"
  | "navigation";

export type IntentType =
  | "browse"
  | "recommend"
  | "compare"
  | "clarify"
  | "modify_requirements"
  | "check_status"
  | "learn_platform"
  | "navigate"
  | "greeting"
  | "followup";

export type ConversationPhase =
  | "greeting"
  | "gathering_requirements"
  | "searching"
  | "recommending"
  | "clarifying"
  | "followup"
  | "topic_switch"
  | "completed";

export interface ProductSearchContext {
  // Core requirements
  category: string | null;
  subcategory: string | null;
  budgetMax: number | null;
  budgetMin: number | null;
  
  // Use case and priorities
  useCase: string | null;
  priorities: string[];
  constraints: string[];
  
  // Features and specifications
  requiredFeatures: Record<string, string | boolean>;
  preferredFeatures: Record<string, string | boolean>;
  excludedFeatures: string[];
  
  // Brands and sellers
  preferredBrands: string[];
  excludedBrands: string[];
  
  // Search refinements
  sortBy: "relevance" | "price_low" | "price_high" | "rating" | "popular" | null;
  
  // Language/style preferences
  language: "en" | "bn" | "mixed" | null;
}

export interface ReferencedProduct {
  id: string;
  title: string;
  price: number;
  category: string;
  position: number; // 1st, 2nd, 3rd in conversation
  mentionedInTurn: number;
  contextLabel: string; // "the laptop", "that one", "the Lenovo"
}

export interface ReferencedOrder {
  id: string;
  status: string;
  totalAmount: number;
  position: number;
  mentionedInTurn: number;
  contextLabel: string; // "my last order", "the first one"
}

export interface UserPreferences {
  // Learned from conversation
  prefersBudgetOptions: boolean;
  prefersPremiumOptions: boolean;
  mentionedUseCases: string[];
  frequentCategories: string[];
  language: "en" | "bn" | "mixed" | null;
}

/**
 * Initialize empty conversation state
 */
export function createInitialState(): ConversationState {
  return {
    currentTopic: null,
    currentIntent: null,
    productContext: null,
    referencedProducts: [],
    referencedOrders: [],
    conversationPhase: "greeting",
    pendingClarification: null,
    userPreferences: {
      prefersBudgetOptions: false,
      prefersPremiumOptions: false,
      mentionedUseCases: [],
      frequentCategories: [],
      language: null,
    },
    topicHistory: [],
    lastUpdateTurn: 0,
  };
}

/**
 * Initialize product search context
 */
export function createProductSearchContext(): ProductSearchContext {
  return {
    category: null,
    subcategory: null,
    budgetMax: null,
    budgetMin: null,
    useCase: null,
    priorities: [],
    constraints: [],
    requiredFeatures: {},
    preferredFeatures: {},
    excludedFeatures: [],
    preferredBrands: [],
    excludedBrands: [],
    sortBy: null,
    language: null,
  };
}

/**
 * Detect if a topic switch has occurred
 */
export function detectTopicSwitch(
  currentState: ConversationState,
  newTopic: TopicType
): boolean {
  if (!currentState.currentTopic) return false;
  if (currentState.currentTopic === newTopic) return false;
  
  // Product search to product comparison is not a switch
  if (
    currentState.currentTopic === "product_search" &&
    newTopic === "product_comparison"
  ) {
    return false;
  }
  
  // Related topics are not switches
  const relatedTopics: Record<TopicType, TopicType[]> = {
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
  
  const related = relatedTopics[currentState.currentTopic] || [];
  return !related.includes(newTopic);
}

/**
 * Update conversation state with new information
 */
export function updateConversationState(
  state: ConversationState,
  updates: Partial<ConversationState>,
  turnNumber: number
): ConversationState {
  const newState = { ...state, ...updates, lastUpdateTurn: turnNumber };
  
  // Track topic changes
  if (updates.currentTopic && updates.currentTopic !== state.currentTopic) {
    newState.topicHistory = [
      ...state.topicHistory,
      { topic: updates.currentTopic, turn: turnNumber },
    ];
    
    // Clear product context on topic switch if not related
    if (
      state.currentTopic &&
      detectTopicSwitch(state, updates.currentTopic)
    ) {
      newState.productContext = null;
      newState.referencedProducts = [];
    }
  }
  
  return newState;
}

/**
 * Laptop → headphone (and similar) stays on product_search, so topic-switch
 * detection does not fire. Reset constraints when the product type changes.
 */
export function resetProductContextForCategorySwitch(
  state: ConversationState,
  nextCategory: string | null
): ConversationState {
  const current = state.productContext?.category;
  if (!nextCategory || !current || current.toLowerCase() === nextCategory.toLowerCase()) {
    return state;
  }

  return {
    ...state,
    productContext: {
      ...createProductSearchContext(),
      category: nextCategory,
      language: state.productContext?.language || null,
    },
    referencedProducts: [],
    conversationPhase: "gathering_requirements",
  };
}

/**
 * Add referenced product to state
 */
export function addReferencedProduct(
  state: ConversationState,
  product: {
    id: string;
    title: string;
    price: number;
    category: string;
  },
  position: number,
  turnNumber: number
): ConversationState {
  const contextLabel = generateProductLabel(product, position);
  
  const referenced: ReferencedProduct = {
    id: product.id,
    title: product.title,
    price: product.price,
    category: product.category,
    position,
    mentionedInTurn: turnNumber,
    contextLabel,
  };
  
  // Keep only recent references (last 10 products)
  const referencedProducts = [...state.referencedProducts, referenced].slice(-10);
  
  return { ...state, referencedProducts };
}

/**
 * Generate contextual label for product
 */
function generateProductLabel(
  product: { title: string; category: string },
  position: number
): string {
  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const ordinal = ordinals[position - 1] || `#${position}`;
  
  // Extract brand if present
  const brandMatch = product.title.match(/^([A-Z][a-z]+|[A-Z]+)/);
  const brand = brandMatch ? brandMatch[1] : null;
  
  if (brand) {
    return `the ${brand} (${ordinal} one)`;
  }
  
  return `the ${ordinal} one`;
}

/**
 * Resolve product reference from user message
 */
export function resolveProductReference(
  message: string,
  state: ConversationState
): ReferencedProduct | null {
  if (state.referencedProducts.length === 0) return null;
  
  const lower = message.toLowerCase();
  
  // Ordinal references
  const ordinalMap: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    "1st": 1,
    "2nd": 2,
    "3rd": 3,
    "4th": 4,
    "5th": 5,
  };
  
  for (const [word, position] of Object.entries(ordinalMap)) {
    if (lower.includes(word)) {
      const product = state.referencedProducts.find(
        (p) => p.position === position
      );
      if (product) return product;
    }
  }
  
  // Direct references
  if (lower.includes("that one") || lower.includes("this one")) {
    return state.referencedProducts[state.referencedProducts.length - 1];
  }
  
  if (lower.includes("last one") || lower.includes("previous one")) {
    return state.referencedProducts[state.referencedProducts.length - 1];
  }
  
  // Brand references
  const words = message.split(/\s+/);
  for (const word of words) {
    const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
    const product = state.referencedProducts.find((p) =>
      p.title.includes(capitalized)
    );
    if (product) return product;
  }
  
  // Price references (the cheaper one, the expensive one)
  if (lower.includes("cheap") || lower.includes("lower price")) {
    return state.referencedProducts.reduce((cheapest, p) =>
      p.price < cheapest.price ? p : cheapest
    );
  }
  
  if (lower.includes("expensive") || lower.includes("higher price") || lower.includes("pricey")) {
    return state.referencedProducts.reduce((expensive, p) =>
      p.price > expensive.price ? p : expensive
    );
  }
  
  return null;
}

/**
 * Merge conversation history into state
 */
export function reconstructStateFromHistory(
  messages: Array<{ role: string; content: string }>,
  existingState?: ConversationState
): ConversationState {
  const state = existingState || createInitialState();
  
  // Analyze conversation history to rebuild state
  // This is a simplified version - in production, you'd store state snapshots
  
  return state;
}

/**
 * Summarize state for AI context
 */
export function summarizeStateForAI(state: ConversationState): string {
  const parts: string[] = [];
  
  if (state.currentTopic) {
    parts.push(`Current topic: ${state.currentTopic}`);
  }
  
  if (state.productContext) {
    const ctx = state.productContext;
    const requirements: string[] = [];
    
    if (ctx.category) requirements.push(`category: ${ctx.category}`);
    if (ctx.budgetMax) requirements.push(`budget: ≤৳${ctx.budgetMax}`);
    if (ctx.useCase) requirements.push(`use case: ${ctx.useCase}`);
    if (ctx.priorities.length > 0) {
      requirements.push(`priorities: ${ctx.priorities.join(", ")}`);
    }
    if (ctx.requiredFeatures && Object.keys(ctx.requiredFeatures).length > 0) {
      requirements.push(
        `required: ${Object.entries(ctx.requiredFeatures)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      );
    }
    
    if (requirements.length > 0) {
      parts.push(`Product requirements: ${requirements.join("; ")}`);
    }
  }
  
  if (state.referencedProducts.length > 0) {
    const recent = state.referencedProducts.slice(-3);
    parts.push(
      `Referenced products: ${recent
        .map((p) => `${p.position}. ${p.title} (৳${p.price})`)
        .join(", ")}`
    );
  }
  
  if (state.conversationPhase) {
    parts.push(`Phase: ${state.conversationPhase}`);
  }
  
  return parts.join(" | ");
}
