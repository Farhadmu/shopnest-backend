import { Order } from "../orders/order.model";
import { Product } from "../products/product.model";
import { Review } from "../reviews/review.model";
import { Wishlist } from "../wishlist/wishlist.model";
import { Cart } from "../cart/cart.model";
import { Store } from "../sellers/store.model";
import { buildPublicProductFilter, getPublicProduct } from "../../utils/activeProductFilter";
import { PLATFORM_KNOWLEDGE } from "./platform-knowledge";

export interface ProductSearchOptions {
  query?: string;
  budgetMax?: number;
  budgetMin?: number;
  category?: string;
  limit?: number;
}

export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export async function searchProducts(options: ProductSearchOptions): Promise<ToolResult<any[]>> {
  try {
    const filter = await buildPublicProductFilter({});
    if (options.budgetMax) filter.price = { $lte: options.budgetMax };
    if (options.budgetMin) filter.price = { ...(filter.price as any), $gte: options.budgetMin };
    if (options.category) filter.category = { $regex: options.category, $options: "i" };

    const textSearch = (options.query || "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (textSearch.length > 0) {
      filter.$text = { $search: textSearch };
    }

    const limit = options.limit || 8;
    let products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(limit).lean();

    if (products.length === 0 && textSearch.length > 0) {
      const relaxedFilter = await buildPublicProductFilter({});
      if (options.budgetMax) relaxedFilter.price = { $lte: options.budgetMax };
      const words = textSearch.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0) {
        relaxedFilter.$or = words.map((w) => ({
          $or: [
            { title: { $regex: w, $options: "i" } },
            { category: { $regex: w, $options: "i" } },
            { tags: { $regex: w, $options: "i" } },
          ],
        }));
      }
      products = await Product.find(relaxedFilter).sort({ ratingAvg: -1 }).limit(limit).lean();
    }

    return {
      success: true,
      data: products.map((p: any) => ({
        id: p._id?.toString() || p.id,
        title: p.title,
        price: p.price,
        discountPrice: p.discountPrice,
        category: p.category,
        ratingAvg: p.ratingAvg || 0,
        ratingCount: p.ratingCount || 0,
        stock: p.stock || 0,
        sold: p.sold || 0,
        images: p.images || [],
        description: p.description,
        specifications: p.specifications instanceof Map ? Object.fromEntries(p.specifications) : { ...(p.specifications || {}) },
        freeDelivery: p.freeDelivery,
        warrantyMonths: p.warrantyMonths,
        seller: p.sellerId ? { storeName: "ShopNest Seller", trustScore: 0 } : undefined,
      })),
    };
  } catch {
    return { success: false, error: "Failed to search products" };
  }
}

export async function getProductDetails(productId: string): Promise<ToolResult<any>> {
  try {
    const product = await getPublicProduct(productId);
    if (!product) return { success: false, error: "Product not found" };

    const store = product.sellerId ? await Store.findOne({ ownerId: product.sellerId }).lean() : null;
    return {
      success: true,
      data: {
        id: product._id?.toString() || "",
        title: product.title,
        price: product.price,
        discountPrice: product.discountPrice,
        category: product.category,
        ratingAvg: product.ratingAvg || 0,
        ratingCount: product.ratingCount || 0,
        stock: product.stock || 0,
        sold: product.sold || 0,
        images: product.images || [],
        description: product.description,
        specifications: product.specifications instanceof Map ? Object.fromEntries(product.specifications) : { ...(product.specifications || {}) },
        freeDelivery: product.freeDelivery,
        warrantyMonths: product.warrantyMonths,
        seller: store ? { storeName: store.storeName, trustScore: store.trustScore || 0 } : undefined,
      },
    };
  } catch {
    return { success: false, error: "Failed to fetch product details" };
  }
}

export async function getCustomerOverview(userId: string): Promise<ToolResult<any>> {
  try {
    const orders = await Order.find({ userId }).lean();
    const wishlist = await Wishlist.findOne({ userId }).lean();
    const cart = await Cart.findOne({ userId }).lean();
    const activeOrders = orders.filter((o: any) => !["delivered", "cancelled", "returned", "refunded"].includes(o.status));
    const totalSpent = orders
      .filter((o: any) => ["delivered", "shipped", "out_for_delivery"].includes(o.status))
      .reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

    return {
      success: true,
      data: {
        totalOrders: orders.length,
        activeOrders: activeOrders.length,
        deliveredOrders: orders.filter((o: any) => o.status === "delivered").length,
        wishlistCount: wishlist?.items?.length || 0,
        cartCount: cart?.items?.length || 0,
        totalSpent,
      },
    };
  } catch {
    return { success: false, error: "Failed to fetch overview" };
  }
}

export async function getCustomerOrders(userId: string, limit = 10): Promise<ToolResult<any[]>> {
  try {
    const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    return {
      success: true,
      data: orders.map((o: any) => ({
        id: o._id?.toString() || "",
        status: o.status,
        totalAmount: o.totalAmount || 0,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        items: (o.items || []).map((it: any) => ({
          productId: it.productId,
          title: it.title,
          price: it.price,
          quantity: it.quantity,
          image: it.image,
        })),
        shippingAddress: o.shippingAddress,
      })),
    };
  } catch {
    return { success: false, error: "Failed to fetch orders" };
  }
}

export async function getActiveOrders(userId: string): Promise<ToolResult<any[]>> {
  const result = await getCustomerOrders(userId, 20);
  if (!result.success || !result.data) return result;
  const active = result.data.filter((o: any) => !["delivered", "cancelled", "returned", "refunded"].includes(o.status));
  return { success: true, data: active };
}

export async function getWishlist(userId: string): Promise<ToolResult<any[]>> {
  try {
    const wishlist = await Wishlist.findOne({ userId }).lean();
    if (!wishlist || !wishlist.items.length) return { success: true, data: [] };

    const productIds = wishlist.items.map((i: any) => i.productId);
    const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
    const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));

    return {
      success: true,
      data: wishlist.items
        .map((i: any) => {
          const p = productMap.get(i.productId);
          if (!p) return null;
          return {
            productId: i.productId,
            title: p.title,
            price: p.price,
            discountPrice: p.discountPrice,
            category: p.category,
            ratingAvg: p.ratingAvg || 0,
            stock: p.stock || 0,
            images: p.images || [],
            addedAt: i.addedAt,
          };
        })
        .filter(Boolean),
    };
  } catch {
    return { success: false, error: "Failed to fetch wishlist" };
  }
}

export async function getCart(userId: string): Promise<ToolResult<{ items: any[]; subtotal: number; itemCount: number }>> {
  try {
    const cart = await Cart.findOne({ userId }).lean();
    if (!cart || !cart.items.length) return { success: true, data: { items: [], subtotal: 0, itemCount: 0 } };

    const productIds = cart.items.map((i: any) => i.productId);
    const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
    const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));

    const items = cart.items
      .map((i: any) => {
        const p = productMap.get(i.productId);
        if (!p) return null;
        return {
          productId: i.productId,
          title: p.title,
          price: i.price,
          quantity: i.quantity,
          image: p.images?.[0],
          stock: p.stock || 0,
        };
      })
      .filter(Boolean);

    const subtotal = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    return { success: true, data: { items, subtotal, itemCount: items.length } };
  } catch {
    return { success: false, error: "Failed to fetch cart" };
  }
}

export async function getProductReviews(productId: string): Promise<ToolResult<any[]>> {
  try {
    const reviews = await Review.find({ productId }).sort({ createdAt: -1 }).limit(20).lean();
    return {
      success: true,
      data: reviews.map((r: any) => ({
        id: r._id?.toString() || "",
        rating: r.rating,
        comment: r.comment,
        userName: r.userName,
        verifiedPurchase: r.verifiedPurchase,
        createdAt: r.createdAt,
      })),
    };
  } catch {
    return { success: false, error: "Failed to fetch reviews" };
  }
}

export async function getSellerInfo(sellerId: string): Promise<ToolResult<any>> {
  try {
    const store = await Store.findOne({ ownerId: sellerId }).lean();
    if (!store) return { success: false, error: "Store not found" };
    return {
      success: true,
      data: {
        id: store._id?.toString() || "",
        storeName: store.storeName,
        trustScore: store.trustScore || 0,
        rating: store.rating || 0,
        ratingCount: store.ratingCount || 0,
        status: store.status,
        description: store.description,
      },
    };
  } catch {
    return { success: false, error: "Failed to fetch seller info" };
  }
}

export async function getDeliveryStatus(userId: string, orderId: string): Promise<ToolResult<any>> {
  try {
    const order = await Order.findOne({ userId, _id: orderId }).lean();
    if (!order) return { success: false, error: "Order not found" };

    const latestHistory = order.statusHistory && order.statusHistory.length > 0
      ? order.statusHistory[order.statusHistory.length - 1]
      : null;

    return {
      success: true,
      data: {
        orderId: order._id?.toString() || "",
        orderStatus: order.status,
        deliveryManId: order.deliveryManId,
        deliveredAt: order.deliveredAt,
        lastUpdate: latestHistory?.at,
        trackingHistory: order.statusHistory || [],
      },
    };
  } catch {
    return { success: false, error: "Failed to fetch delivery status" };
  }
}

export async function getReturnEligibility(userId: string, orderId: string): Promise<ToolResult<any>> {
  try {
    const order = await Order.findOne({ userId, _id: orderId }).lean();
    if (!order) return { success: false, error: "Order not found" };

    const deliveredAt = order.deliveredAt || order.updatedAt;
    const daysSinceDelivery = deliveredAt ? Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const isEligible = daysSinceDelivery !== null && daysSinceDelivery <= 7 && order.status === "delivered";

    return {
      success: true,
      data: {
        orderId: order._id?.toString() || "",
        orderStatus: order.status,
        deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : null,
        daysSinceDelivery,
        isEligible,
        returnPolicy: PLATFORM_KNOWLEDGE.returnPolicy,
      },
    };
  } catch {
    return { success: false, error: "Failed to check return eligibility" };
  }
}

export async function addToCart(userId: string, productId: string, quantity = 1): Promise<ToolResult<any>> {
  try {
    const product = await getPublicProduct(productId);
    if (!product) return { success: false, error: "Product not found" };
    if (product.stock && product.stock < quantity) return { success: false, error: `Only ${product.stock} items available in stock` };

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      await Cart.create({
        userId,
        items: [{ productId, price: product.discountPrice || product.price, quantity }],
      });
    } else {
      const existing = cart.items.find((i: any) => i.productId === productId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        cart.items.push({ productId, price: product.discountPrice || product.price, quantity });
      }
      await cart.save();
    }

    return { success: true, data: { productId, title: product.title, price: product.discountPrice || product.price, quantity }, message: `Added ${product.title} to cart` };
  } catch {
    return { success: false, error: "Failed to add to cart" };
  }
}

export async function removeFromCart(userId: string, productId: string): Promise<ToolResult<any>> {
  try {
    const cart = await Cart.findOne({ userId });
    if (!cart) return { success: false, error: "Cart is empty" };

    const initialLength = cart.items.length;
    cart.items = cart.items.filter((i: any) => i.productId !== productId);
    if (cart.items.length === initialLength) return { success: false, error: "Item not found in cart" };

    await cart.save();
    return { success: true, data: { productId }, message: "Item removed from cart" };
  } catch {
    return { success: false, error: "Failed to remove from cart" };
  }
}

export async function addToWishlist(userId: string, productId: string): Promise<ToolResult<any>> {
  try {
    const product = await getPublicProduct(productId);
    if (!product) return { success: false, error: "Product not found" };

    const wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      await Wishlist.create({ userId, items: [{ productId, addedAt: new Date() }] });
    } else {
      const exists = wishlist.items.some((i: any) => i.productId === productId);
      if (exists) return { success: false, error: "Item already in wishlist" };
      wishlist.items.push({ productId, addedAt: new Date() });
      await wishlist.save();
    }

    return { success: true, data: { productId, title: product.title }, message: `Added ${product.title} to wishlist` };
  } catch {
    return { success: false, error: "Failed to add to wishlist" };
  }
}

export async function removeFromWishlist(userId: string, productId: string): Promise<ToolResult<any>> {
  try {
    const wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) return { success: false, error: "Wishlist is empty" };

    const initialLength = wishlist.items.length;
    wishlist.items = wishlist.items.filter((i: any) => i.productId !== productId);
    if (wishlist.items.length === initialLength) return { success: false, error: "Item not found in wishlist" };

    await wishlist.save();
    return { success: true, data: { productId }, message: "Item removed from wishlist" };
  } catch {
    return { success: false, error: "Failed to remove from wishlist" };
  }
}

export async function searchPlatformKnowledge(query: string): Promise<ToolResult<string>> {
  try {
    const lowerQuery = query.toLowerCase();
    const knowledge = PLATFORM_KNOWLEDGE;

    const relevantSections: string[] = [];

    if (lowerQuery.includes("shopnest") || lowerQuery.includes("what is") || lowerQuery.includes("about") || lowerQuery.includes("how does")) {
      relevantSections.push(`About ShopNest: ${knowledge.description}`);
      relevantSections.push("Key Features:");
      for (const [key, value] of Object.entries(knowledge.features)) {
        relevantSections.push(`- ${key}: ${value}`);
      }
    }

    if (lowerQuery.includes("register") || lowerQuery.includes("sign up") || lowerQuery.includes("account") || lowerQuery.includes("create account")) {
      relevantSections.push(`Registration: ${knowledge.customerWorkflows.register}`);
    }

    if (lowerQuery.includes("seller") && (lowerQuery.includes("become") || lowerQuery.includes("how to") || lowerQuery.includes("join"))) {
      relevantSections.push(`Become a Seller: ${knowledge.customerWorkflows.becomeSeller}`);
      relevantSections.push("Seller Payout Methods:");
      for (const method of knowledge.sellerPayoutMethods) {
        relevantSections.push(`- ${method.label}: ${method.description}`);
      }
    }

    if (lowerQuery.includes("payment") || lowerQuery.includes("pay") || lowerQuery.includes("checkout")) {
      relevantSections.push("Payment Methods:");
      for (const method of knowledge.paymentMethods) {
        relevantSections.push(`- ${method.label}: ${method.description}`);
      }
      relevantSections.push(`Checkout: ${knowledge.customerWorkflows.checkout}`);
    }

    if (lowerQuery.includes("delivery") || lowerQuery.includes("shipping") || lowerQuery.includes("track")) {
      relevantSections.push("Shipping Methods:");
      for (const method of knowledge.shippingMethods) {
        relevantSections.push(`- ${method.label}: ${method.description} (৳${method.fee})`);
      }
      relevantSections.push(`Track Order: ${knowledge.customerWorkflows.trackOrder}`);
    }

    if (lowerQuery.includes("return") || lowerQuery.includes("refund") || lowerQuery.includes("exchange")) {
      relevantSections.push(`Return Policy: ${knowledge.returnPolicy.description}`);
      relevantSections.push(`Return Window: ${knowledge.returnPolicy.windowDays} days from delivery`);
      relevantSections.push(`Processing Time: ${knowledge.returnPolicy.processingTime}`);
      relevantSections.push("Required Evidence:");
      for (const evidence of knowledge.returnPolicy.requiredEvidence) {
        relevantSections.push(`- ${evidence}`);
      }
    }

    if (lowerQuery.includes("support") || lowerQuery.includes("help") || lowerQuery.includes("contact")) {
      relevantSections.push(`Support Email: ${knowledge.support.email}`);
      relevantSections.push(`Support Ticket System: ${knowledge.support.ticketSystem}`);
    }

    if (lowerQuery.includes("wishlist")) {
      relevantSections.push(`Wishlist: ${knowledge.customerWorkflows.wishlist}`);
    }

    if (lowerQuery.includes("cart")) {
      relevantSections.push(`Cart: ${knowledge.customerWorkflows.addToCart}`);
    }

    if (lowerQuery.includes("order") && (lowerQuery.includes("where") || lowerQuery.includes("track") || lowerQuery.includes("status"))) {
      relevantSections.push(`Track Order: ${knowledge.customerWorkflows.trackOrder}`);
    }

    if (relevantSections.length === 0) {
      return {
        success: true,
        data: `ShopNest is a multi-vendor marketplace. You can browse products, compare items, add to cart/wishlist, track orders, and more. Ask me about any specific feature!`,
      };
    }

    return { success: true, data: relevantSections.join("\n") };
  } catch {
    return { success: false, error: "Failed to search platform knowledge" };
  }
}

export function getPlatformRoutes(): Record<string, string> {
  return {
    home: "/",
    products: "/products",
    cart: "/cart",
    wishlist: "/wishlist",
    orders: "/orders",
    checkout: "/checkout",
    compare: "/compare",
    stores: "/stores",
    notifications: "/notifications",
    aiAdvisor: "/ai-advisor",
    login: "/login",
    register: "/register",
    becomeSeller: "/become-seller",
    support: "/support",
    dashboardUser: "/dashboard/user",
    dashboardUserOrders: "/dashboard/user/orders",
    dashboardUserProfile: "/dashboard/user/profile",
    dashboardUserNotifications: "/dashboard/user/notifications",
  };
}

export function getParameterizedRoutes(): Record<string, (params: Record<string, string>) => string> {
  return {
    productDetail: (params) => `/products/${params.id}`,
    orderDetail: (params) => `/orders/${params.id}`,
    storeDetail: (params) => `/stores/${params.id}`,
  };
}

export function getRouteUrl(routeKey: string, params?: Record<string, string>): string | null {
  const stringRoutes = getPlatformRoutes();
  const paramRoutes = getParameterizedRoutes();

  if (routeKey in stringRoutes) {
    return stringRoutes[routeKey as keyof typeof stringRoutes];
  }
  if (routeKey in paramRoutes && params) {
    return paramRoutes[routeKey as keyof typeof paramRoutes](params);
  }
  return null;
}
