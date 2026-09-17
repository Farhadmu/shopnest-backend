/**
 * Conversational AI Advisor Controller
 * 
 * This is the main controller that orchestrates the conversational AI experience,
 * integrating state management, intent extraction, tool execution, and AI reasoning.
 */

import { Request, Response } from "express";
import { AiConversation, sanitizeAiConversationMessages } from "./conversation.model";
import { 
  ConversationState, 
  createInitialState, 
  createProductSearchContext,
  updateConversationState,
  addReferencedProduct,
  resolveProductReference,
  detectTopicSwitch,
} from "./conversation-state";
import { extractIntent, ExtractedIntent } from "./intent-extraction";
import { CONVERSATIONAL_ADVISOR_SYSTEM, buildConversationalPrompt, buildDeterministicFallbackResponse } from "./conversational-prompts";
import { completeWithContext, AiContext } from "../providers/claude.provider";
import {
  searchProducts,
  getCustomerOrders,
  getActiveOrders,
  getWishlist,
  getCart,
  getDeliveryStatus,
  getReturnEligibility,
  searchPlatformKnowledge,
  getPlatformRoutes,
  getProductDetails,
  getCustomerOverview,
} from "../commerce-companion.tools";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { logAiIncident } from "../incident/incident.service";

interface ConversationalResponse {
  reply: string;
  conversationId: string;
  turnCount: number;
  conversationPhase: string;
  products?: any[];
  orders?: any[];
  wishlistItems?: any[];
  cartItems?: any[];
  cartSummary?: { subtotal: number; itemCount: number };
  navigation?: any[];
  actions?: any[];
  contextReferences?: any[];
  thinking?: string;
  isFallback: boolean;
  provider?: string;
  providerStatus: string;
  topicSwitchDetected?: boolean;
  clarificationNeeded?: boolean;
}

type ContextReference = {
  id: string;
  type: string;
  title: string;
};

function toContextReference(value: unknown): ContextReference | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : null;
  const type = typeof candidate.type === "string" ? candidate.type : null;
  const title = typeof candidate.title === "string" ? candidate.title : null;

  return id && type && title ? { id, type, title } : null;
}

export const conversationalChat = asyncHandler(async (req: Request, res: Response) => {
  const { message, conversationId } = req.body as {
    message: string;
    conversationId?: string;
  };

  if (!message || typeof message !== "string") {
    throw ApiError.badRequest("Message is required");
  }

  const userId = req.user?.id;
  const isAuthenticated = !!userId;

  // Load or create conversation
  let conversation: any;
  if (userId) {
    if (conversationId) {
      conversation = await AiConversation.findOne({ _id: conversationId, userId });
    }
    if (!conversation) {
      conversation = await AiConversation.create({
        userId,
        messages: [],
        conversationState: createInitialState(),
        turnCount: 0,
      });
    } else {
      // Older persisted messages can contain metadata written before the
      // context-reference sub-schema existed. Normalize before mutating so a
      // legacy record never blocks the current conversation with a CastError.
      conversation.messages = sanitizeAiConversationMessages(conversation.messages || []);
    }
  } else {
    // Guest conversation (not persisted)
    conversation = {
      messages: [],
      conversationState: createInitialState(),
      turnCount: 0,
    };
  }

  // Increment turn counter
  const turnNumber = conversation.turnCount + 1;
  
  // Get conversation state
  let state: ConversationState = conversation.conversationState || createInitialState();
  
  // Add user message
  const userMessage = {
    role: "user" as const,
    content: message,
    at: new Date(),
  };
  conversation.messages.push(userMessage);

  // Extract intent considering conversation context
  const conversationHistory = conversation.messages.slice(-20).map((m: any) => ({
    role: m.role,
    content: m.content,
  }));
  
  const intent: ExtractedIntent = extractIntent(message, state, conversationHistory);
  
  let thinking = "";
  const toolResults: string[] = [];
  const structuredData: {
    products?: any[];
    orders?: any[];
    wishlistItems?: any[];
    cartItems?: any[];
    cartSummary?: { subtotal: number; itemCount: number };
    overview?: any;
    delivery?: any;
    returnEligibility?: any;
  } = {};
  const contextReferences: ContextReference[] = [];
  const actions: any[] = [];
  
  // Detect topic switch
  const topicSwitchDetected = intent.topic && detectTopicSwitch(state, intent.topic);
  
  // Update conversation state with new intent
  state = updateConversationState(
    state,
    {
      currentIntent: intent.intent,
      currentTopic: intent.topic || state.currentTopic,
      conversationPhase: intent.requiresClarification ? "clarifying" : determinePhase(intent.intent),
      pendingClarification: intent.clarificationQuestion,
      userPreferences: {
        ...state.userPreferences,
        language: intent.extractedEntities.detectedLanguage,
        mentionedUseCases: intent.extractedEntities.useCase
          ? [...state.userPreferences.mentionedUseCases, intent.extractedEntities.useCase]
          : state.userPreferences.mentionedUseCases,
      },
    },
    turnNumber
  );
  
  // Handle product context updates
  if (intent.intent === "recommend" || intent.intent === "modify_requirements") {
    if (!state.productContext) {
      state.productContext = createProductSearchContext();
    }
    
    // Update product context with extracted entities
    const entities = intent.extractedEntities;
    
    if (entities.category) {
      state.productContext.category = entities.category;
    }
    if (entities.budgetMax) {
      state.productContext.budgetMax = entities.budgetMax;
    }
    if (entities.budgetMin) {
      state.productContext.budgetMin = entities.budgetMin;
    }
    if (entities.useCase) {
      state.productContext.useCase = entities.useCase;
    }
    if (entities.features.length > 0) {
      entities.features.forEach((feature) => {
        state.productContext!.requiredFeatures[feature] = true;
      });
    }
    if (entities.priorityChanges.length > 0) {
      state.productContext.priorities = [
        ...state.productContext.priorities,
        ...entities.priorityChanges,
      ];
    }
    if (entities.brands.length > 0) {
      state.productContext.preferredBrands = [
        ...state.productContext.preferredBrands,
        ...entities.brands,
      ];
    }
    if (entities.excludedBrands.length > 0) {
      state.productContext.excludedBrands = [
        ...state.productContext.excludedBrands,
        ...entities.excludedBrands,
      ];
    }
    if (entities.budgetChange === "decrease" && state.productContext.budgetMax) {
      state.productContext.budgetMax = Math.round(state.productContext.budgetMax * 0.8);
    }
    if (entities.budgetChange === "increase" && state.productContext.budgetMax) {
      state.productContext.budgetMax = Math.round(state.productContext.budgetMax * 1.2);
    }
    
    state.productContext.language = entities.detectedLanguage;
  }
  
  // Handle reference resolution
  if (intent.intent === "followup" && intent.extractedEntities.productReference) {
    const resolvedProduct = resolveProductReference(message, state);
    if (resolvedProduct) {
      thinking = `Checking ${resolvedProduct.title}...`;
      const productDetails = await getProductDetails(resolvedProduct.id);
      if (productDetails.success && productDetails.data) {
        structuredData.products = [productDetails.data];
        toolResults.push(`Product Details for ${resolvedProduct.title}:`);
        toolResults.push(`- ID: ${productDetails.data.id}`);
        toolResults.push(`- Price: ৳${productDetails.data.price}`);
        toolResults.push(`- Rating: ${productDetails.data.ratingAvg}/5`);
        toolResults.push(`- Stock: ${productDetails.data.stock}`);
        if (productDetails.data.warrantyMonths) {
          toolResults.push(`- Warranty: ${productDetails.data.warrantyMonths} months`);
        }
        if (productDetails.data.specifications) {
          toolResults.push(`- Specifications: ${JSON.stringify(productDetails.data.specifications)}`);
        }
      }
    }
  }
  
  // Execute tools based on intent
  try {
    if (intent.intent === "recommend" && state.productContext && !intent.requiresClarification) {
      thinking = "Searching ShopNest catalog...";
      
      const searchOptions = {
        query: message,
        budgetMax: state.productContext.budgetMax || undefined,
        budgetMin: state.productContext.budgetMin || undefined,
        category: state.productContext.category || undefined,
        limit: 8,
      };
      
      const searchResult = await searchProducts(searchOptions);
      if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
        structuredData.products = searchResult.data;
        
        toolResults.push(`Found ${searchResult.data.length} products:`);
        searchResult.data.forEach((p: any, idx: number) => {
          toolResults.push(
            `${idx + 1}. [${p.id}] ${p.title} | ৳${p.price} | ${p.category} | ${p.ratingAvg}/5 stars | stock: ${p.stock}`
          );
          const contextReference = toContextReference({ id: p.id, type: "product", title: p.title });
          if (contextReference) contextReferences.push(contextReference);
          
          // Add to referenced products for future resolution
          state = addReferencedProduct(state, p, idx + 1, turnNumber);
        });
      } else {
        toolResults.push("No products found matching the criteria.");
      }
    }
    
    if (intent.intent === "compare" && state.referencedProducts.length >= 2) {
      thinking = "Comparing products...";
      const compareProducts = state.referencedProducts.slice(-5);
      structuredData.products = compareProducts.map((rp) => ({
        id: rp.id,
        title: rp.title,
        price: rp.price,
        category: rp.category,
      }));
      toolResults.push(`Comparing ${compareProducts.length} products:`);
      compareProducts.forEach((p, idx) => {
        toolResults.push(`${idx + 1}. ${p.title} - ৳${p.price}`);
      });
    }
    
    if (intent.topic === "order_inquiry" && isAuthenticated && userId) {
      thinking = "Checking your orders...";
      const ordersResult = await getCustomerOrders(userId, 10);
      if (ordersResult.success && ordersResult.data && ordersResult.data.length > 0) {
        structuredData.orders = ordersResult.data;
        toolResults.push(`Found ${ordersResult.data.length} orders:`);
        ordersResult.data.forEach((o: any) => {
          toolResults.push(
            `- Order #${o.id.slice(-6)} | ৳${o.totalAmount} | ${o.status} | ${new Date(o.createdAt).toLocaleDateString()}`
          );
          const contextReference = toContextReference({ id: o.id, type: "order", title: `Order ${o.id.slice(-6)}` });
          if (contextReference) contextReferences.push(contextReference);
        });
      } else {
        toolResults.push("You have no orders yet.");
      }
    } else if (intent.topic === "order_inquiry" && !isAuthenticated) {
      toolResults.push("Please sign in to view your orders.");
      actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
    }
    
    if (intent.topic === "delivery_tracking" && isAuthenticated && userId) {
      thinking = "Checking delivery status...";
      const activeOrdersResult = await getActiveOrders(userId);
      if (activeOrdersResult.success && activeOrdersResult.data && activeOrdersResult.data.length > 0) {
        structuredData.orders = activeOrdersResult.data;
        const latestOrder = activeOrdersResult.data[0];
        const deliveryResult = await getDeliveryStatus(userId, latestOrder.id);
        if (deliveryResult.success && deliveryResult.data) {
          structuredData.delivery = deliveryResult.data;
          toolResults.push(`Delivery status for Order #${latestOrder.id.slice(-6)}:`);
          toolResults.push(`- Status: ${deliveryResult.data.orderStatus}`);
          if (deliveryResult.data.deliveryManId) {
            toolResults.push(`- Delivery Man ID: ${deliveryResult.data.deliveryManId}`);
          }
        }
      } else {
        toolResults.push("No active deliveries found.");
      }
    }
    
    if (intent.topic === "wishlist" && isAuthenticated && userId) {
      thinking = "Checking your wishlist...";
      const wishlistResult = await getWishlist(userId);
      if (wishlistResult.success && wishlistResult.data && wishlistResult.data.length > 0) {
        structuredData.wishlistItems = wishlistResult.data;
        toolResults.push(`You have ${wishlistResult.data.length} items in your wishlist:`);
        wishlistResult.data.forEach((item: any, idx: number) => {
          toolResults.push(`${idx + 1}. ${item.title} | ৳${item.price}`);
        });
      } else {
        toolResults.push("Your wishlist is empty.");
      }
    } else if (intent.topic === "wishlist" && !isAuthenticated) {
      toolResults.push("Please sign in to view your wishlist.");
      actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
    }
    
    if (intent.topic === "cart" && isAuthenticated && userId) {
      thinking = "Checking your cart...";
      const cartResult = await getCart(userId);
      if (cartResult.success && cartResult.data) {
        structuredData.cartItems = cartResult.data.items;
        structuredData.cartSummary = {
          subtotal: cartResult.data.subtotal,
          itemCount: cartResult.data.itemCount,
        };
        if (cartResult.data.items.length > 0) {
          toolResults.push(`Your cart has ${cartResult.data.items.length} items (Subtotal: ৳${cartResult.data.subtotal.toLocaleString()}):`);
          cartResult.data.items.forEach((item: any, idx: number) => {
            toolResults.push(`${idx + 1}. ${item.title} | ৳${item.price} × ${item.quantity}`);
          });
        } else {
          toolResults.push("Your cart is empty.");
        }
      }
    } else if (intent.topic === "cart" && !isAuthenticated) {
      toolResults.push("Please sign in to view your cart.");
      actions.push({ type: "navigate", label: "Sign In", targetUrl: "/login" });
    }
    
    if (intent.topic === "return_inquiry" && isAuthenticated && userId) {
      thinking = "Checking return eligibility...";
      const ordersResult = await getCustomerOrders(userId, 10);
      if (ordersResult.success && ordersResult.data && ordersResult.data.length > 0) {
        const deliveredOrders = ordersResult.data.filter((o: any) => o.status === "delivered");
        if (deliveredOrders.length > 0) {
          const latestDelivered = deliveredOrders[0];
          const returnResult = await getReturnEligibility(userId, latestDelivered.id);
          if (returnResult.success && returnResult.data) {
            structuredData.returnEligibility = returnResult.data;
            toolResults.push(`Return eligibility for Order #${latestDelivered.id.slice(-6)}:`);
            toolResults.push(`- Delivered: ${returnResult.data.daysSinceDelivery} days ago`);
            toolResults.push(`- Eligible: ${returnResult.data.isEligible ? "Yes" : "No"}`);
            toolResults.push(`- Policy: ${returnResult.data.returnPolicy.windowDays}-day return window`);
          }
        } else {
          toolResults.push("No delivered orders found to check return eligibility.");
        }
      }
    }
    
    if (intent.topic === "platform_help") {
      thinking = "Looking up platform information...";
      const knowledgeResult = await searchPlatformKnowledge(message);
      if (knowledgeResult.success && knowledgeResult.data) {
        toolResults.push(knowledgeResult.data);
      }
    }
    
    if (intent.topic === "navigation") {
      thinking = "Finding the right page...";
      const routes = getPlatformRoutes();
      const lower = message.toLowerCase();
      let targetRoute: string | null = null;
      
      if (lower.includes("wishlist")) targetRoute = routes.wishlist;
      else if (lower.includes("cart")) targetRoute = routes.cart;
      else if (lower.includes("order")) targetRoute = routes.orders;
      else if (lower.includes("product")) targetRoute = routes.products;
      else if (lower.includes("dashboard")) targetRoute = routes.dashboardUser;
      
      if (targetRoute) {
        actions.push({ type: "navigate", label: `Open ${targetRoute}`, targetUrl: targetRoute });
        toolResults.push(`You can find this at: ${targetRoute}`);
      }
    }
    
    // Get customer overview for general chat with authenticated users
    if (intent.intent === "greeting" && isAuthenticated && userId) {
      const overviewResult = await getCustomerOverview(userId);
      if (overviewResult.success && overviewResult.data) {
        structuredData.overview = overviewResult.data;
      }
    }
  } catch (error) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: userId,
      endpoint: "/ai/advisor/conversational-chat",
      input: message,
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with fallback
  }
  
  // Build AI context
  const aiContext: AiContext = {
    products: (structuredData.products || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      category: p.category,
      ratingAvg: p.ratingAvg || 0,
      stock: p.stock || 0,
    })),
    orders: (structuredData.orders || []).map((o: any) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
    })),
    wishlist: (structuredData.wishlistItems || []).map((w: any) => ({
      title: w.title,
      price: w.price,
    })),
    userContext: structuredData.overview,
  };
  
  // Generate AI response
  const toolResultsString = toolResults.length > 0 ? toolResults.join("\n") : "No tool results.";
  const userPrompt = buildConversationalPrompt(
    message,
    state,
    toolResultsString,
    conversationHistory,
    isAuthenticated
  );
  
  let reply: string;
  let isFallback = false;
  let provider: string | undefined;
  
  try {
    const result = await completeWithContext(
      [{ role: "user" as const, content: userPrompt }],
      aiContext,
      { system: CONVERSATIONAL_ADVISOR_SYSTEM, maxTokens: 2000, temperature: 0.3 }
    );
    reply = result.content;
    isFallback = result.isFallback;
    provider = result.provider;
  } catch (err) {
    await logAiIncident({
      type: "PROVIDER_ERROR",
      userId: userId,
      endpoint: "/ai/advisor/conversational-chat",
      input: message,
      error: err instanceof Error ? err.message : String(err),
    });
    reply = buildDeterministicFallbackResponse(message, state, structuredData, isAuthenticated);
    isFallback = true;
    provider = "deterministic";
  }
  
  // Add assistant message
  const assistantMessage = {
    role: "assistant" as const,
    content: reply,
    at: new Date(),
    products: structuredData.products?.slice(0, 5).map((p, idx) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      category: p.category,
      position: idx + 1,
    })),
    orders: structuredData.orders?.slice(0, 5).map((o, idx) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
      position: idx + 1,
    })),
    contextReferences: contextReferences.length > 0 ? contextReferences : undefined,
  };
  conversation.messages.push(assistantMessage);
  
  // Update conversation state and turn count
  conversation.conversationState = state;
  conversation.turnCount = turnNumber;
  
  // Save conversation for authenticated users
  if (userId && conversation.save) {
    await conversation.save();
  }
  
  // Build response
  const response: ConversationalResponse = {
    reply,
    conversationId: conversation._id?.toString() || "",
    turnCount: turnNumber,
    conversationPhase: state.conversationPhase,
    products: structuredData.products,
    orders: structuredData.orders,
    wishlistItems: structuredData.wishlistItems,
    cartItems: structuredData.cartItems,
    cartSummary: structuredData.cartSummary,
    navigation: actions.filter((a) => a.type === "navigate"),
    actions: actions.filter((a) => a.type !== "navigate"),
    contextReferences,
    thinking,
    isFallback,
    provider,
    providerStatus: isFallback ? "unavailable" : "available",
    topicSwitchDetected: topicSwitchDetected || undefined,
    clarificationNeeded: intent.requiresClarification || undefined,
  };
  
  sendSuccess(res, response);
});

function determinePhase(intent: string): "greeting" | "gathering_requirements" | "searching" | "recommending" | "clarifying" | "followup" | "topic_switch" | "completed" {
  switch (intent) {
    case "greeting":
      return "greeting";
    case "browse":
      return "gathering_requirements";
    case "recommend":
      return "recommending";
    case "clarify":
      return "clarifying";
    case "followup":
      return "followup";
    case "modify_requirements":
      return "gathering_requirements";
    default:
      return "followup";
  }
}

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw ApiError.unauthorized("Authentication required");
  }
  
  const conversation = await AiConversation.findOne({
    _id: req.params.id,
    userId: req.user.id,
  });
  
  if (!conversation) {
    throw ApiError.notFound("Conversation not found");
  }
  
  sendSuccess(res, conversation.toJSON());
});

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw ApiError.unauthorized("Authentication required");
  }
  
  const conversations = await AiConversation.find({ userId: req.user.id })
    .sort({ lastActiveAt: -1 })
    .limit(20)
    .select("_id turnCount lastActiveAt createdAt");
  
  sendSuccess(res, conversations);
});

export const deleteConversation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw ApiError.unauthorized("Authentication required");
  }
  
  const conversation = await AiConversation.findOne({
    _id: req.params.id,
    userId: req.user.id,
  });
  
  if (!conversation) {
    throw ApiError.notFound("Conversation not found");
  }
  
  await conversation.deleteOne();
  
  sendSuccess(res, { message: "Conversation deleted" });
});
