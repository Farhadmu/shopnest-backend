export type RiskLevel = "READ" | "LOW_RISK_WRITE" | "HIGH_RISK_WRITE" | "CRITICAL_WRITE";

export interface AdminAIEvidence {
  source: string;
  fact: string;
  value: string | number | boolean;
  recordCount?: number;
  timestamp: string;
}

export interface AdminAIActionPreview {
  id: string;
  action: string;
  label: string;
  description: string;
  targetType: "SELLER" | "PRODUCT" | "ORDER" | "DELIVERY" | "COUPON" | "INCIDENT" | "USER" | "SYSTEM";
  targetId?: string;
  targetName?: string;
  previousState?: string;
  newState?: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  payload?: Record<string, unknown>;
  consequences?: string[];
  affectedRecordsCount?: number;
}

export interface AdminAIAuditReceipt {
  auditId: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetName?: string;
  performedBy: string;
  status: "SUCCESS" | "FAILED";
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface AdminAIPageContext {
  route?: string;
  module?: string;
  entityType?: string;
  selectedEntityId?: string;
  filters?: Record<string, unknown>;
}

export interface AdminAIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  evidence?: AdminAIEvidence[];
  actions?: AdminAIActionPreview[];
  receipts?: AdminAIAuditReceipt[];
  referencedEntities?: {
    sellers?: Array<{ id: string; storeName: string; status: string; trustScore?: number; rating?: number; orders?: number }>;
    products?: Array<{ id: string; title: string; price: number; stock: number; status: string; category?: string }>;
    orders?: Array<{ id: string; status: string; totalAmount: number; customerName?: string; createdAt?: string }>;
    deliveries?: Array<{ id: string; name?: string; status: string; activeOrders?: number; phone?: string }>;
    incidents?: Array<{ id: string; title: string; severity: string; status: string }>;
  };
  metrics?: Array<{
    label: string;
    value: string | number;
    formatted?: string;
    changePercent?: number;
    trend?: "up" | "down" | "neutral";
  }>;
  quickReplies?: string[];
  timestamp: Date;
}

export interface AdminAIConversationState {
  conversationId: string;
  adminId: string;
  recentEntities: {
    lastSellers?: Array<{ id: string; storeName: string; status: string }>;
    lastProducts?: Array<{ id: string; title: string; price: number; stock: number }>;
    lastOrders?: Array<{ id: string; status: string; totalAmount: number }>;
    lastDeliveries?: Array<{ id: string; name: string }>;
    lastIncidents?: Array<{ id: string; title: string }>;
  };
  pendingAction?: AdminAIActionPreview;
  activeContext?: AdminAIPageContext;
  updatedAt: Date;
}

export interface AdminAIResponse {
  answer: string;
  conversationId: string;
  intent: string;
  confidence: number;
  evidence: AdminAIEvidence[];
  actions: AdminAIActionPreview[];
  receipts?: AdminAIAuditReceipt[];
  referencedEntities?: AdminAIMessage["referencedEntities"];
  metrics?: AdminAIMessage["metrics"];
  quickReplies?: string[];
  isFallback?: boolean;
}
