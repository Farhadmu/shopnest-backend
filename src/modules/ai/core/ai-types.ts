import { Types } from "mongoose";

/**
 * The five specialized AI experiences across ShopNest
 */
export type AIExperience =
  | "ADVISOR"
  | "CUSTOMER_COPILOT"
  | "SELLER_COPILOT"
  | "ADMIN_COPILOT"
  | "DELIVERY_COPILOT";

export type UserRole = "customer" | "seller" | "admin" | "delivery_man" | "guest";

export type RiskLevel = "READ" | "LOW_RISK_WRITE" | "HIGH_RISK_WRITE";

/**
 * Standardized evidence item attached to an AI conclusion or insight
 */
export interface AIEvidence {
  type: "DATABASE" | "CALCULATION" | "SEARCH" | "SYSTEM";
  source: string;
  resourceId?: string;
  fact: string;
  value: string | number | boolean;
  timestamp: Date;
}

/**
 * Action request from the AI that may require user confirmation
 */
export interface AIActionRequirement {
  id: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  action: string;
  label: string;
  description: string;
  targetUrl?: string;
  payload?: Record<string, unknown>;
}

/**
 * Standard AI contextual container for the current request turn
 */
export interface AIContext {
  userId?: string;
  sellerId?: string;
  deliveryManId?: string;
  role: UserRole;
  aiType: AIExperience;
  conversationId: string;
  currentPage?: string;
  currentEntity?: {
    type: "product" | "order" | "store" | "delivery" | "incident";
    id: string;
  };
  activeProducts?: string[];
  activeOrders?: string[];
  activeDeliveries?: string[];
  preferences?: Record<string, unknown>;
  permissions: string[];
  locale?: string;
}

/**
 * Context handoff container between AI experiences (e.g. Advisor -> Customer Copilot)
 */
export interface AIHandoffContext {
  handoffId: string;
  from: AIExperience;
  to: AIExperience;
  userId?: string;
  productIds?: string[];
  orderIds?: string[];
  deliveryIds?: string[];
  conversationSummary?: string;
  suggestedAction?: string;
  preferences?: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Unified Tool execution result
 */
export interface AIToolResult<T = unknown> {
  toolName: string;
  success: boolean;
  data: T;
  evidence: AIEvidence[];
  summary?: string;
  error?: string;
}

/**
 * Standard output returned by the Unified AI Core to any caller
 */
export interface AICoreResponse {
  answer: string;
  aiType: AIExperience;
  conversationId: string;
  confidence: number;
  provider: string;
  isFallback: boolean;
  evidence: AIEvidence[];
  actions: AIActionRequirement[];
  metrics?: Array<{
    label: string;
    value: string | number;
    changePercent?: number;
    trend?: "up" | "down" | "neutral";
  }>;
  referencedEntities?: {
    products?: Array<{
      id: string;
      title: string;
      price: number;
      image?: string;
      rating?: number;
      category?: string;
    }>;
    orders?: Array<{
      id: string;
      status: string;
      totalAmount: number;
      createdAt?: Date;
    }>;
    deliveries?: Array<{
      id: string;
      status: string;
      pickupStore?: string;
      destinationAddress?: string;
    }>;
  };
  handoffAvailable?: boolean;
  handoffContext?: AIHandoffContext;
}
