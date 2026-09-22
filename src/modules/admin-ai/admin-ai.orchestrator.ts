import { parseAdminIntent, ParsedAdminIntent } from "./admin-ai.intent";
import {
  AdminAIResponse,
  AdminAIActionPreview,
  AdminAIConversationState,
  AdminAIPageContext,
  AdminAIAuditReceipt,
  AdminAIEvidence,
} from "./admin-ai.types";
import * as tools from "./admin-ai.tools";
import { AiProviderService } from "../ai/core/ai-provider.service";
import { ChatMessage } from "../ai/providers/claude.provider";

// In-memory persistent session registry for admin sessions
const sessionMemory = new Map<string, AdminAIConversationState>();

export class AdminAiOrchestrator {
  private static getOrCreateState(conversationId: string, adminId: string): AdminAIConversationState {
    let state = sessionMemory.get(conversationId);
    if (!state) {
      state = {
        conversationId,
        adminId,
        recentEntities: {},
        updatedAt: new Date(),
      };
      sessionMemory.set(conversationId, state);
    }
    return state;
  }

  /**
   * Main turn processing pipeline
   */
  public static async processTurn(params: {
    query: string;
    adminId: string;
    adminName: string;
    conversationId?: string;
    pageContext?: AdminAIPageContext;
  }): Promise<AdminAIResponse> {
    const { query, adminId, adminName } = params;
    const conversationId = params.conversationId || `conv-${adminId}-${Date.now()}`;
    const state = this.getOrCreateState(conversationId, adminId);
    if (params.pageContext) {
      state.activeContext = params.pageContext;
    }

    const parsed = parseAdminIntent(query);

    // ──────────────────────────────────────────────────────────────────────────
    // 1. CONFIRMATION OF PENDING HIGH-RISK MUTATION
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "CONFIRM_ACTION" && state.pendingAction) {
      const receipt = await this.executeAction(state.pendingAction, adminId, adminName);
      const targetName = state.pendingAction.targetName || "item";
      state.pendingAction = undefined;

      return {
        answer: `Action confirmed and executed successfully.\n\nTarget: **${targetName}**\nAudit ID: \`${receipt.auditId}\``,
        conversationId,
        intent: "CONFIRM_ACTION",
        confidence: 1.0,
        evidence: [
          {
            source: "SecurityAuditLog",
            fact: `Executed administrative mutation: ${receipt.action}`,
            value: `Status: ${receipt.status}`,
            timestamp: receipt.timestamp,
          },
        ],
        actions: [],
        receipts: [receipt],
        quickReplies: ["Give me today's briefing", "Show pending sellers", "Show today's revenue"],
      };
    }

    if (parsed.intent === "CANCEL_ACTION" && state.pendingAction) {
      const cancelled = state.pendingAction;
      state.pendingAction = undefined;
      return {
        answer: `Action cancelled. No modifications were made to **${cancelled.targetName || "the resource"}**.`,
        conversationId,
        intent: "CANCEL_ACTION",
        confidence: 1.0,
        evidence: [],
        actions: [],
        quickReplies: ["Give me today's briefing", "Show all sellers", "Show today's orders"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. DAILY EXECUTIVE BRIEFING
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "BRIEFING") {
      const briefing = await tools.getMarketplaceBriefing();
      return {
        answer: briefing.summary,
        conversationId,
        intent: "BRIEFING",
        confidence: 0.98,
        evidence: briefing.evidence,
        actions: [],
        metrics: briefing.metrics,
        quickReplies: ["Show pending sellers", "Show low-stock products", "Show delayed deliveries", "Show today's revenue"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. REJECT SELLER (High-Risk Mutation -> Previews action)
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "REJECT_SELLER") {
      let targetStore = null;

      if (parsed.entities.sellerName) {
        targetStore = await tools.findSellerByNameOrId(parsed.entities.sellerName);
      } else if (parsed.entities.ordinalReference && state.recentEntities.lastSellers?.length) {
        const idx =
          parsed.entities.ordinalReference === "first"
            ? 0
            : parsed.entities.ordinalReference === "second"
            ? 1
            : parsed.entities.ordinalReference === "third"
            ? 2
            : parsed.entities.ordinalReference === "last"
            ? state.recentEntities.lastSellers.length - 1
            : 0;
        const ref = state.recentEntities.lastSellers[idx];
        if (ref) targetStore = await tools.findSellerByNameOrId(ref.id);
      }

      if (!targetStore) {
        return {
          answer: `I could not find a seller matching "${parsed.entities.sellerName || "your reference"}". Please verify the store name or ID.`,
          conversationId,
          intent: "REJECT_SELLER",
          confidence: 0.8,
          evidence: [],
          actions: [],
          quickReplies: ["Show pending sellers", "Show all sellers"],
        };
      }

      const effectiveReason = parsed.entities.reason || "Incomplete verification documents";
      const actionPreview: AdminAIActionPreview = {
        id: `act-reject-${Date.now()}`,
        action: "SELLER_REJECT",
        label: "Reject Seller Verification",
        description: `Reject seller application for "${targetStore.storeName}".`,
        targetType: "SELLER",
        targetId: String(targetStore._id),
        targetName: targetStore.storeName,
        previousState: targetStore.status,
        newState: "rejected",
        riskLevel: "HIGH_RISK_WRITE",
        requiresConfirmation: true,
        payload: { sellerId: String(targetStore._id), reason: effectiveReason },
        consequences: [
          `Store "${targetStore.storeName}" status will change from "${targetStore.status}" to "rejected".`,
          `Owner will receive an official in-app rejection notification.`,
          `Store listings will remain hidden from the marketplace.`,
        ],
      };

      state.pendingAction = actionPreview;

      return {
        answer: `I found **${targetStore.storeName}** (Current Status: *${targetStore.status}*).\n\nReason: *${effectiveReason}*\n\nThis is a protected administrative action. Would you like to proceed?`,
        conversationId,
        intent: "REJECT_SELLER",
        confidence: 0.95,
        evidence: [
          {
            source: "MongoDB.Store",
            fact: `Inspected merchant application for "${targetStore.storeName}"`,
            value: `Status: ${targetStore.status}`,
            timestamp: new Date().toISOString(),
          },
        ],
        actions: [actionPreview],
        quickReplies: ["Confirm Reject", "Cancel Action"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. APPROVE SELLER (High-Risk Mutation -> Previews action)
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "APPROVE_SELLER") {
      let targetStore = null;

      if (parsed.entities.sellerName) {
        targetStore = await tools.findSellerByNameOrId(parsed.entities.sellerName);
      } else if (parsed.entities.ordinalReference && state.recentEntities.lastSellers?.length) {
        const ref = state.recentEntities.lastSellers[0];
        if (ref) targetStore = await tools.findSellerByNameOrId(ref.id);
      }

      if (!targetStore) {
        return {
          answer: `I could not find a seller matching "${parsed.entities.sellerName || "your reference"}".`,
          conversationId,
          intent: "APPROVE_SELLER",
          confidence: 0.8,
          evidence: [],
          actions: [],
          quickReplies: ["Show pending sellers"],
        };
      }

      const actionPreview: AdminAIActionPreview = {
        id: `act-approve-${Date.now()}`,
        action: "SELLER_APPROVE",
        label: "Approve Seller Store",
        description: `Approve store verification for "${targetStore.storeName}".`,
        targetType: "SELLER",
        targetId: String(targetStore._id),
        targetName: targetStore.storeName,
        previousState: targetStore.status,
        newState: "approved",
        riskLevel: "HIGH_RISK_WRITE",
        requiresConfirmation: true,
        payload: { sellerId: String(targetStore._id) },
        consequences: [
          `Store "${targetStore.storeName}" status will change to "approved".`,
          `Owner role will be synchronized to "seller".`,
          `Products from this merchant will become active in the public catalog.`,
        ],
      };

      state.pendingAction = actionPreview;

      return {
        answer: `I found **${targetStore.storeName}** (Current Status: *${targetStore.status}*).\n\nApprove this merchant store for marketplace trading?`,
        conversationId,
        intent: "APPROVE_SELLER",
        confidence: 0.95,
        evidence: [
          {
            source: "MongoDB.Store",
            fact: `Inspected merchant application for "${targetStore.storeName}"`,
            value: `Status: ${targetStore.status}`,
            timestamp: new Date().toISOString(),
          },
        ],
        actions: [actionPreview],
        quickReplies: ["Confirm Approve", "Cancel Action"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. GET PENDING SELLERS / GET ALL SELLERS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_PENDING_SELLERS" || parsed.intent === "GET_SELLERS") {
      const isPending = parsed.intent === "GET_PENDING_SELLERS" || parsed.entities.statusFilter === "pending";
      const res = await tools.getSellers({
        status: isPending ? "pending" : "all",
        limit: 10,
      });

      state.recentEntities.lastSellers = res.sellers.map((s) => ({ id: s.id, storeName: s.storeName, status: s.status }));

      const title = isPending ? `Found ${res.count} pending seller applications:` : `Found ${res.count} registered sellers:`;
      const quickReplies = res.sellers.length > 0
        ? isPending
          ? [`Approve ${res.sellers[0].storeName}`, `Reject ${res.sellers[0].storeName}`, "Show all sellers"]
          : ["Show pending sellers", "Show low-stock products"]
        : ["Show all sellers"];

      return {
        answer: title,
        conversationId,
        intent: parsed.intent,
        confidence: 0.95,
        evidence: res.evidence,
        actions: [],
        referencedEntities: {
          sellers: res.sellers,
        },
        quickReplies,
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. LOW STOCK PRODUCTS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_LOW_STOCK_PRODUCTS" || parsed.intent === "GET_PRODUCTS") {
      const isLowStock = parsed.intent === "GET_LOW_STOCK_PRODUCTS";
      const res = await tools.getProducts({
        lowStock: isLowStock,
        limit: 10,
      });

      state.recentEntities.lastProducts = res.products.map((p) => ({ id: p.id, title: p.title, price: p.price, stock: p.stock }));

      const title = isLowStock
        ? `Found ${res.count} products with critical low stock (≤ 5 items):`
        : `Found ${res.count} products in catalog:`;

      return {
        answer: title,
        conversationId,
        intent: parsed.intent,
        confidence: 0.95,
        evidence: res.evidence,
        actions: [],
        referencedEntities: {
          products: res.products,
        },
        quickReplies: ["Notify affected sellers", "Show delayed orders", "Give me today's briefing"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. DELAYED ORDERS / GET ORDERS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_DELAYED_ORDERS" || parsed.intent === "GET_ORDERS") {
      const isDelayed = parsed.intent === "GET_DELAYED_ORDERS";
      const res = await tools.getOrders({
        delayedOnly: isDelayed,
        limit: 10,
      });

      state.recentEntities.lastOrders = res.orders.map((o) => ({ id: o.id, status: o.status, totalAmount: o.totalAmount }));

      const title = isDelayed
        ? `Found ${res.count} orders currently delayed beyond 48 hours:`
        : `Found ${res.count} recent orders:`;

      return {
        answer: title,
        conversationId,
        intent: parsed.intent,
        confidence: 0.95,
        evidence: res.evidence,
        actions: [],
        referencedEntities: {
          orders: res.orders,
        },
        quickReplies: ["Show online delivery men", "Show today's revenue", "Give me today's briefing"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 8. DELIVERY FLEET / RIDERS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_DELIVERY_FLEET") {
      const res = await tools.getDeliveryFleet();
      state.recentEntities.lastDeliveries = res.deliveries.map((d) => ({ id: d.id, name: d.name }));

      return {
        answer: `Delivery fleet status: **${res.totalOnline}** partners are currently active/online out of ${res.deliveries.length} registered riders.`,
        conversationId,
        intent: "GET_DELIVERY_FLEET",
        confidence: 0.95,
        evidence: res.evidence,
        actions: [],
        referencedEntities: {
          deliveries: res.deliveries,
        },
        quickReplies: ["Show delayed orders", "Show pending sellers", "Give me today's briefing"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 9. REVENUE & GMV ANALYTICS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_REVENUE_ANALYTICS") {
      const briefing = await tools.getMarketplaceBriefing();
      return {
        answer: `Today's gross revenue is **${briefing.metrics[0].formatted}** across **${briefing.metrics[1].formatted}**.\n\nTrend: ${
          briefing.metrics[0].changePercent !== undefined && briefing.metrics[0].changePercent >= 0
            ? `+${briefing.metrics[0].changePercent}% vs yesterday`
            : `${briefing.metrics[0].changePercent}% vs yesterday`
        }.`,
        conversationId,
        intent: "GET_REVENUE_ANALYTICS",
        confidence: 0.95,
        evidence: briefing.evidence,
        actions: [],
        metrics: [briefing.metrics[0], briefing.metrics[1]],
        quickReplies: ["Why did revenue drop yesterday?", "Show top sellers", "Give me today's briefing"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 10. ANOMALIES & INCIDENTS
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "GET_ANOMALIES" || parsed.intent === "GET_INCIDENTS") {
      const res = await tools.getAnomaliesAndIncidents();
      state.recentEntities.lastIncidents = res.incidents.map((i) => ({ id: i.id, title: i.title }));

      return {
        answer: `Platform Security & Risk Status: Found **${res.incidents.length}** active security incidents and **${res.anomalies.length}** anomalies requiring review.`,
        conversationId,
        intent: parsed.intent,
        confidence: 0.92,
        evidence: res.evidence,
        actions: [],
        referencedEntities: {
          incidents: res.incidents,
        },
        quickReplies: ["Show pending sellers", "Show delayed orders", "Give me today's briefing"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 11. NAVIGATION
    // ──────────────────────────────────────────────────────────────────────────
    if (parsed.intent === "NAVIGATION" && parsed.entities.targetNavigationUrl) {
      const url = parsed.entities.targetNavigationUrl;
      return {
        answer: `Navigating to **${url}**...`,
        conversationId,
        intent: "NAVIGATION",
        confidence: 0.95,
        evidence: [],
        actions: [
          {
            id: `nav-${Date.now()}`,
            action: "NAVIGATE",
            label: `Open ${url.split("/").pop()}`,
            description: `Navigate to ${url}`,
            targetType: "SYSTEM",
            riskLevel: "READ",
            requiresConfirmation: false,
            payload: { url },
          },
        ],
        quickReplies: ["Give me today's briefing", "Show all sellers"],
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 12. COMPLEX / CROSS-MODULE LLM REASONING (Fallback with real DB evidence)
    // ──────────────────────────────────────────────────────────────────────────
    const briefingData = await tools.getMarketplaceBriefing();
    const chatMessages: ChatMessage[] = [
      {
        role: "user",
        content: `Admin Question: "${query}"\n\nVerified Real Marketplace Data:\n${briefingData.evidence.map((e) => `- ${e.fact}: ${e.value}`).join("\n")}`,
      },
    ];

    const systemPrompt = `You are the ShopNest Full-Platform Agentic Admin Operating System.
You assist marketplace administrators with factual, evidence-backed answers in English, Bengali (বাংলা), or Banglish.
Strict Guidelines:
1. Ground every answer strictly in the provided verified data facts.
2. NEVER invent fake revenue, fake orders, fake sellers, or fake IDs.
3. Be professional, direct, and concise like a senior marketplace operations director.
4. Avoid fluff like "Sure!" or "I would be happy to help".`;

    const providerResult = await AiProviderService.executeCompletion(
      chatMessages,
      systemPrompt,
      {
        role: "admin",
        aiType: "ADMIN_COPILOT",
        userId: adminId,
        conversationId,
        permissions: ["admin"],
      },
      briefingData.evidence as any
    );

    return {
      answer: providerResult.content,
      conversationId,
      intent: "GENERAL_QUERY",
      confidence: providerResult.isFallback ? 0.75 : 0.9,
      evidence: briefingData.evidence,
      actions: [],
      metrics: briefingData.metrics.slice(0, 2),
      quickReplies: ["Give me today's briefing", "Show pending sellers", "Show low-stock products"],
    };
  }

  /**
   * Directly executes an authorized action after explicit administrator confirmation
   */
  public static async executeAction(
    action: AdminAIActionPreview,
    adminId: string,
    adminName: string
  ): Promise<AdminAIAuditReceipt> {
    const payload = action.payload || {};

    switch (action.action) {
      case "SELLER_REJECT": {
        const sellerId = String(payload.sellerId || action.targetId);
        const reason = String(payload.reason || "Incomplete verification documents");
        return await tools.executeRejectSeller({ sellerId, reason, adminId, adminName });
      }

      case "SELLER_APPROVE": {
        const sellerId = String(payload.sellerId || action.targetId);
        return await tools.executeApproveSeller({ sellerId, adminId, adminName });
      }

      case "ORDER_CANCEL": {
        const orderId = String(payload.orderId || action.targetId);
        const reason = String(payload.reason || "Cancelled by admin");
        return await tools.executeCancelOrder({ orderId, reason, adminId, adminName });
      }

      case "COUPON_DISABLE": {
        const couponCode = String(payload.couponCode || action.targetId);
        return await tools.executeDisableCoupon({ couponCode, adminId, adminName });
      }

      case "INCIDENT_RESOLVE": {
        const incidentId = String(payload.incidentId || action.targetId);
        const notes = String(payload.notes || "Resolved via Admin AI");
        return await tools.executeResolveIncident({ incidentId, notes, adminId, adminName });
      }

      case "NOTIFICATION_BROADCAST": {
        const recipientType = (payload.recipientType as any) || "seller";
        const title = String(payload.title || "Administrative Notice");
        const message = String(payload.message || "");
        return await tools.executeBroadcastNotification({ recipientType, title, message, adminId, adminName });
      }

      default:
        throw new Error(`Unsupported action type: ${action.action}`);
    }
  }
}
