import {
  AIExperience,
  UserRole,
  AIContext,
  AICoreResponse,
  AIEvidence,
  AIActionRequirement,
} from "./ai-types";
import { AiPermissionService } from "./ai-permission.service";
import { AiToolService } from "./ai-tool.service";
import { AiEvidenceService } from "./ai-evidence.service";
import { AiMemoryService } from "./ai-memory.service";
import { AiHandoffService } from "./ai-handoff.service";
import { AiProviderService } from "./ai-provider.service";
import { ChatMessage } from "../providers/claude.provider";

export interface ProcessAiInput {
  prompt: string;
  aiType: AIExperience;
  role: UserRole;
  userId?: string;
  sellerId?: string;
  deliveryManId?: string;
  conversationId?: string;
  sessionId?: string;
  currentPage?: string;
  handoffId?: string;
}

export class AiCoreService {
  /**
   * Main entrypoint: Orchestrates context, permissions, tools, provider, memory, and evidence
   */
  public static async processTurn(input: ProcessAiInput): Promise<AICoreResponse> {
    const { prompt, aiType, role, userId, sellerId, deliveryManId, conversationId, sessionId } = input;

    // 1. Prompt Injection Security Check
    AiPermissionService.validatePromptSecurity(prompt);

    // 2. Resolve or resume Conversation Memory
    const conversation = await AiMemoryService.getOrCreateConversation(
      aiType,
      role,
      userId,
      conversationId,
      sessionId
    );

    // 3. Resolve context and permission envelope
    const context: AIContext = {
      userId,
      sellerId,
      deliveryManId,
      role,
      aiType,
      conversationId: String(conversation._id),
      currentPage: input.currentPage,
      permissions: [role],
    };

    // 4. Handle incoming handoff if token provided
    let handoffSummary = "";
    if (input.handoffId) {
      const consumedHandoff = AiHandoffService.consumeHandoff(input.handoffId);
      if (consumedHandoff) {
        handoffSummary = `[HANDOFF CONTEXT from ${consumedHandoff.from}: ${consumedHandoff.conversationSummary}. Target items: ${consumedHandoff.productIds?.join(", ")}]`;
      }
    }

    // 5. Gather evidence and execute role-aware tools against real MongoDB collections
    const evidence: AIEvidence[] = [];
    const actions: AIActionRequirement[] = [];
    let referencedProducts: any[] = [];
    let referencedOrders: any[] = [];
    let referencedDeliveries: any[] = [];
    let detectedTopic = "general";

    // -------------------------------------------------------------
    // TOOL EXECUTION BY ROLE & EXPERIENCE
    // -------------------------------------------------------------
    if (aiType === "ADVISOR") {
      detectedTopic = "shopping_discovery";
      // Public / Customer Catalog Search
      const catalogResult = await AiToolService.searchCatalogProducts(context, {
        query: prompt,
        limit: 4,
      });
      if (catalogResult.success && catalogResult.data) {
        referencedProducts = catalogResult.data;
        evidence.push(...catalogResult.evidence);
      }

      // Check if user is referencing a previously shown item
      const refResolution = AiMemoryService.resolveEntityReference(prompt, referencedProducts);
      if (refResolution?.targetProductId) {
        evidence.push(
          AiEvidenceService.fromSearch(
            "ReferenceResolution",
            `Resolved user reference "${refResolution.reason}" to product`,
            refResolution.targetProductId
          )
        );
      }
    } else if (aiType === "CUSTOMER_COPILOT") {
      detectedTopic = "customer_account";
      const lower = prompt.toLowerCase();

      // Determine customer tool to execute based on intent
      if (lower.includes("cart") || lower.includes("shopping bag")) {
        const cartRes = await AiToolService.getCustomerCart(context);
        if (cartRes.success) evidence.push(...cartRes.evidence);
      } else if (lower.includes("wishlist") || lower.includes("saved")) {
        const wishRes = await AiToolService.getCustomerWishlist(context);
        if (wishRes.success) {
          referencedProducts = wishRes.data;
          evidence.push(...wishRes.evidence);
        }
      } else if (lower.includes("return") || lower.includes("refund")) {
        const retRes = await AiToolService.getCustomerReturns(context);
        if (retRes.success) evidence.push(...retRes.evidence);
      } else {
        // Default customer intent: Orders & Delivery tracking
        const ordersRes = await AiToolService.getCustomerOrders(context, { limit: 4 });
        if (ordersRes.success && ordersRes.data) {
          referencedOrders = ordersRes.data;
          evidence.push(...ordersRes.evidence);
        }
      }
    } else if (aiType === "SELLER_COPILOT") {
      detectedTopic = "seller_business";
      const lower = prompt.toLowerCase();

      if (lower.includes("inventory") || lower.includes("stock")) {
        const invRes = await AiToolService.getSellerInventory(context);
        if (invRes.success) evidence.push(...invRes.evidence);
      } else {
        const salesRes = await AiToolService.getSellerSales(context);
        if (salesRes.success) evidence.push(...salesRes.evidence);
      }
    } else if (aiType === "ADMIN_COPILOT") {
      detectedTopic = "marketplace_intelligence";
      const adminRes = await AiToolService.getMarketplaceMetrics(context);
      if (adminRes.success) evidence.push(...adminRes.evidence);
    } else if (aiType === "DELIVERY_COPILOT") {
      detectedTopic = "logistics_operations";
      const delivRes = await AiToolService.getActiveDeliveries(context);
      if (delivRes.success && delivRes.data) {
        referencedDeliveries = delivRes.data;
        evidence.push(...delivRes.evidence);
      }
    }

    // 6. Build Role-Specific System Prompt
    const systemPrompt = AiCoreService.buildSystemPrompt(aiType, role, handoffSummary);

    // 7. Format conversation messages
    const chatMessages: ChatMessage[] = (conversation.messages || []).slice(-8).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
    chatMessages.push({ role: "user", content: prompt });

    // 8. Execute completion via 4-tier provider stack with database evidence
    const providerResult = await AiProviderService.executeCompletion(
      chatMessages,
      systemPrompt,
      context,
      evidence
    );

    // 9. Generate suggested actions
    AiCoreService.populateSuggestedActions(aiType, prompt, actions, referencedProducts, referencedOrders);

    // 10. Record turn in persistent memory
    await AiMemoryService.recordTurn(String(conversation._id), prompt, providerResult.content, {
      evidenceSummary: evidence.map((e) => e.fact).join("; "),
      productIds: referencedProducts.map((p) => p.id),
      orderIds: referencedOrders.map((o) => o.id),
      deliveryIds: referencedDeliveries.map((d) => d.id),
      detectedTopic,
    });

    // 11. Check if handoff is applicable (e.g. on AI Advisor when customer decides on a product)
    let handoffAvailable = false;
    let handoffContext = undefined;
    if (aiType === "ADVISOR" && referencedProducts.length > 0) {
      handoffAvailable = true;
      handoffContext = AiHandoffService.createHandoff({
        from: "ADVISOR",
        to: "CUSTOMER_COPILOT",
        userId,
        productIds: referencedProducts.map((p) => p.id),
        conversationSummary: `Customer explored products including: ${referencedProducts.map((p) => p.title).join(", ")}`,
        suggestedAction: "Proceed to Cart / Checkout with Customer Copilot",
      });
    }

    return {
      answer: providerResult.content,
      aiType,
      conversationId: String(conversation._id),
      confidence: providerResult.isFallback ? 0.85 : 0.98,
      provider: providerResult.provider,
      isFallback: providerResult.isFallback,
      evidence,
      actions,
      referencedEntities: {
        products: referencedProducts,
        orders: referencedOrders,
        deliveries: referencedDeliveries,
      },
      handoffAvailable,
      handoffContext,
    };
  }

  /**
   * Builds distinct system prompts enforcing role constraints and multilingual support
   */
  private static buildSystemPrompt(aiType: AIExperience, role: UserRole, handoffSummary?: string): string {
    const baseRules = `You are ShopNest AI, the intelligent operating layer of Bangladesh's premier multi-vendor commerce platform.
You support English, Bengali (বাংলা), and Banglish naturally.
Strict Rules:
1. Ground your answers strictly in the verified database facts provided below.
2. NEVER invent products, prices, orders, revenue, riders, or coordinates.
3. If data is unavailable, state it clearly.
4. Keep answers concise, human, and helpful. Avoid robotic intros like "According to the database".
${handoffSummary ? `\n${handoffSummary}` : ""}`;

    switch (aiType) {
      case "ADVISOR":
        return `${baseRules}\nRole: Shopping Advisor (Guest & Customer Discovery).
Help users find the ideal products, compare options, evaluate specifications, and choose within their budget.
Maintain conversational context across turns.`;

      case "CUSTOMER_COPILOT":
        return `${baseRules}\nRole: Customer Personal Commerce Assistant.
Assist the authenticated customer with their verified orders, delivery tracking, cart, wishlist, and return requests.
Never expose another customer's data (Anti-IDOR).`;

      case "SELLER_COPILOT":
        return `${baseRules}\nRole: AI Business Manager for Merchants.
Analyze store GMV, pending orders, low stock products, and customer reviews based on verified seller data.
Provide evidence-backed business insights.`;

      case "ADMIN_COPILOT":
        return `${baseRules}\nRole: Marketplace Brain & Command Intelligence.
Evaluate platform-wide GMV, active deliveries, seller risk indicators, and critical anomalies.
Ground all executive conclusions in real telemetry.`;

      case "DELIVERY_COPILOT":
        return `${baseRules}\nRole: Real-Time Logistics Operations Assistant.
Guide the active courier on store pickups, customer dropoffs, and multi-order priority.
NEVER automatically complete, cancel, or reassign deliveries without user confirmation.`;

      default:
        return baseRules;
    }
  }

  /**
   * Populates safe actions based on intent
   */
  private static populateSuggestedActions(
    aiType: AIExperience,
    prompt: string,
    actions: AIActionRequirement[],
    products: any[],
    orders: any[]
  ): void {
    if (aiType === "ADVISOR" && products.length > 0) {
      actions.push({
        id: `act-view-${products[0].id}`,
        riskLevel: "READ",
        requiresConfirmation: false,
        action: "navigate",
        label: `View ${products[0].title.slice(0, 24)}...`,
        description: "Open product details page",
        targetUrl: `/products/${products[0].id}`,
      });
    }

    if (aiType === "CUSTOMER_COPILOT") {
      actions.push({
        id: "act-orders",
        riskLevel: "READ",
        requiresConfirmation: false,
        action: "navigate",
        label: "📦 View Orders",
        description: "View full order history",
        targetUrl: "/dashboard/user/orders",
      });
      actions.push({
        id: "act-cart",
        riskLevel: "READ",
        requiresConfirmation: false,
        action: "navigate",
        label: "🛒 Go to Cart",
        description: "Review cart items",
        targetUrl: "/cart",
      });
    }

    if (aiType === "SELLER_COPILOT") {
      actions.push({
        id: "act-seller-orders",
        riskLevel: "READ",
        requiresConfirmation: false,
        action: "navigate",
        label: "🏪 Orders Dashboard",
        description: "Manage pending customer orders",
        targetUrl: "/dashboard/seller/orders",
      });
    }

    if (aiType === "DELIVERY_COPILOT") {
      actions.push({
        id: "act-delivery-route",
        riskLevel: "READ",
        requiresConfirmation: false,
        action: "navigate",
        label: "🗺️ Open Radar Map",
        description: "View full delivery route on Google Maps",
        targetUrl: "/dashboard/delivery",
      });
    }
  }
}
