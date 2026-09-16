export interface CommerceCompanionProduct {
  id: string;
  title: string;
  price: number;
  discountPrice?: number;
  category: string;
  ratingAvg: number;
  ratingCount: number;
  stock: number;
  sold: number;
  images: string[];
  description?: string;
  specifications?: Record<string, string>;
  seller?: { storeName: string; trustScore: number };
  freeDelivery?: boolean;
  warrantyMonths?: number;
}

export interface CommerceCompanionOrder {
  id: string;
  status: string;
  totalAmount: number;
  paymentStatus: string;
  createdAt: string;
  items: Array<{ productId: string; title: string; price: number; quantity: number; image?: string }>;
  shippingAddress: string;
}

export interface CommerceCompanionWishlistItem {
  productId: string;
  title: string;
  price: number;
  discountPrice?: number;
  category: string;
  ratingAvg: number;
  stock: number;
  images: string[];
  addedAt: string;
}

export interface CommerceCompanionCartItem {
  productId: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  stock: number;
}

export interface CommerceCompanionReview {
  id: string;
  rating: number;
  comment: string;
  userName: string;
  verifiedPurchase: boolean;
  createdAt: string;
}

export interface CommerceCompanionSeller {
  id: string;
  storeName: string;
  trustScore: number;
  rating: number;
  ratingCount: number;
  status: string;
}

export interface CommerceCompanionAction {
  type: "add_to_cart" | "remove_from_cart" | "update_cart_quantity" | "add_to_wishlist" | "remove_from_wishlist" | "navigate" | "confirm" | "open_product" | "open_order" | "open_wishlist" | "open_cart" | "open_orders";
  label: string;
  payload?: Record<string, unknown>;
  targetUrl?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

export interface CommerceCompanionResponse {
  reply: string;
  conversationId: string;
  contextReferences?: Array<{ id: string; type: "product" | "order" | "wishlist_item" | "cart_item"; title: string }>;
  products?: CommerceCompanionProduct[];
  orders?: CommerceCompanionOrder[];
  wishlistItems?: CommerceCompanionWishlistItem[];
  cartItems?: CommerceCompanionCartItem[];
  cartSummary?: { subtotal: number; itemCount: number };
  reviews?: CommerceCompanionReview[];
  seller?: CommerceCompanionSeller;
  delivery?: any;
  returnEligibility?: any;
  overview?: any;
  navigation?: CommerceCompanionAction[];
  actions?: CommerceCompanionAction[];
  isFallback: boolean;
  provider?: string;
  providerStatus?: "available" | "unavailable";
  thinking?: string;
}

export interface CommerceCompanionMessage {
  role: "user" | "assistant";
  content: string;
  at: Date;
  contextReferences?: Array<{ id: string; type: string; title: string }>;
  products?: CommerceCompanionProduct[];
  orders?: CommerceCompanionOrder[];
  actions?: CommerceCompanionAction[];
}

export interface CommerceCompanionConversation {
  _id: string;
  userId: string;
  messages: CommerceCompanionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectedIntent {
  type: "product_search" | "order_inquiry" | "wishlist_inquiry" | "cart_inquiry" | "return_inquiry" | "review_inquiry" | "seller_inquiry" | "navigation" | "platform_question" | "general_chat" | "action_request" | "comparison" | "budget_search" | "delivery_inquiry";
  confidence: number;
  entities?: {
    productIds?: string[];
    orderIds?: string[];
    budget?: number;
    category?: string;
    useCase?: string;
    brand?: string;
  };
  needsConfirmation?: boolean;
}
