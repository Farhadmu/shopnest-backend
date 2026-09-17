import mongoose from "mongoose";
import { Order } from "../../orders/order.model";
import { Product } from "../../products/product.model";
import { Review } from "../../reviews/review.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { Cart } from "../../cart/cart.model";
import { Coupon } from "../../coupons/coupon.model";
import { Notification } from "../../notifications/notification.model";
import { Store } from "../../sellers/store.model";
import { ShoppingGoal } from "../../customer/customer-intelligence.model";
import { ShoppingJourney } from "../../customer/customer-intelligence.model";
import { ProductLifecycle } from "../../customer/customer-intelligence.model";
import { LoyaltyPoints } from "../../customer/customer-features.model";
import { SpendingBudget } from "../../customer/spending-budget.model";
import { DeliveryRequest } from "../../delivery/delivery-request.model";
import { buildPublicProductFilter, getPublicProduct } from "../../../utils/activeProductFilter";

export interface CustomerOverview {
  totalOrders: number;
  activeOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  wishlistCount: number;
  cartCount: number;
  totalSpent: number;
  loyaltyPoints?: number;
  activeGoalsCount?: number;
  activeLifecycleCount?: number;
  unreadNotifications?: number;
}

export interface CustomerOrder {
  id: string;
  status: string;
  totalAmount: number;
  paymentStatus: string;
  createdAt: Date;
  items: Array<{ productId: string; title: string; price: number; quantity: number; image?: string }>;
  shippingAddress: string;
  deliveryStatus?: string;
  isReturnEligible?: boolean;
}

export interface CustomerWishlistItem {
  productId: string;
  title: string;
  price: number;
  discountPrice?: number;
  category: string;
  ratingAvg: number;
  stock: number;
  images: string[];
  addedAt: Date;
}

export interface CustomerCartItem {
  productId: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  stock: number;
}

export interface CustomerSpendingSummary {
  totalSpent: number;
  orderCount: number;
  averageOrderValue: number;
  monthlyBudget?: number;
  categorySpending: Array<{ category: string; amount: number; percentage: number }>;
  recentMonthsSpending: Array<{ month: string; amount: number; orderCount: number }>;
}

export interface CustomerGoalSummary {
  id: string;
  title: string;
  category: string;
  targetBudget: number;
  currentAmount: number;
  progressPercentage: number;
  status: string;
}

export interface CustomerLifecycleSummary {
  id: string;
  productTitle: string;
  category: string;
  purchaseDate: Date;
  warrantyExpiryDate?: Date;
  usagePercentage: number;
  status: string;
}

export interface ProductDetails {
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
  description: string;
  specifications: Record<string, string>;
  seller: { storeName: string; trustScore: number };
}

export async function getCustomerOverview(userId: string): Promise<CustomerOverview> {
  const [orders, wishlist, cart, loyalty, goals, lifecycles, notifications] = await Promise.all([
    Order.find({ userId }).lean(),
    Wishlist.findOne({ userId }).lean(),
    Cart.findOne({ userId }).lean(),
    LoyaltyPoints.findOne({ userId }).lean().catch(() => null),
    ShoppingGoal.countDocuments({ userId, status: "active" }).catch(() => 0),
    ProductLifecycle.countDocuments({ userId, status: "active" }).catch(() => 0),
    Notification.countDocuments({ userId, isRead: false }).catch(() => 0),
  ]);

  const activeOrders = orders.filter((o: any) => !["delivered", "cancelled", "returned", "refunded"].includes(o.status));
  const deliveredOrders = orders.filter((o: any) => o.status === "delivered");
  const totalSpent = orders
    .filter((o: any) => ["delivered", "shipped", "out_for_delivery"].includes(o.status))
    .reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

  return {
    totalOrders: orders.length,
    activeOrders: activeOrders.length,
    deliveredOrders: deliveredOrders.length,
    cancelledOrders: orders.filter((o: any) => o.status === "cancelled").length,
    returnedOrders: orders.filter((o: any) => ["returned", "refunded"].includes(o.status)).length,
    wishlistCount: wishlist?.items?.length || 0,
    cartCount: cart?.items?.length || 0,
    totalSpent,
    loyaltyPoints: loyalty?.availablePoints || 0,
    activeGoalsCount: goals,
    activeLifecycleCount: lifecycles,
    unreadNotifications: notifications,
  };
}

export async function getCustomerOrders(userId: string, startDate?: Date, endDate?: Date): Promise<CustomerOrder[]> {
  const filter: Record<string, unknown> = { userId };
  if (startDate && endDate) {
    filter.createdAt = { $gte: startDate, $lte: endDate };
  }
  const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  return orders.map((o: any) => {
    const isDelivered = o.status === "delivered";
    const deliveredAt = o.updatedAt ? new Date(o.updatedAt).getTime() : new Date(o.createdAt).getTime();
    const isReturnEligible = isDelivered && now - deliveredAt <= SEVEN_DAYS_MS;

    return {
      id: o._id?.toString() || "",
      status: o.status,
      totalAmount: o.totalAmount,
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
      isReturnEligible,
    };
  });
}

export async function getActiveOrders(userId: string): Promise<CustomerOrder[]> {
  const orders = await getCustomerOrders(userId);
  return orders.filter((o) => !["delivered", "cancelled", "returned", "refunded"].includes(o.status));
}

export async function getPastOrders(userId: string): Promise<CustomerOrder[]> {
  const orders = await getCustomerOrders(userId);
  return orders.filter((o) => ["delivered", "cancelled", "returned", "refunded"].includes(o.status));
}

export async function getCustomerSpendingSummary(userId: string): Promise<CustomerSpendingSummary> {
  const [orders, budgetDoc] = await Promise.all([
    Order.find({ userId, status: { $in: ["delivered", "shipped", "out_for_delivery", "processing", "pending"] } }).lean(),
    SpendingBudget.findOne({ userId }).lean().catch(() => null),
  ]);

  const totalSpent = orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
  const orderCount = orders.length;
  const averageOrderValue = orderCount > 0 ? Math.round(totalSpent / orderCount) : 0;

  // Category breakdown
  const categoryMap: Record<string, number> = {};
  for (const o of orders) {
    for (const item of o.items || []) {
      const cat = (item as any).category || "General";
      categoryMap[cat] = (categoryMap[cat] || 0) + item.price * (item.quantity || 1);
    }
  }

  const categorySpending = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Month-by-month breakdown (last 6 months)
  const monthMap: Record<string, { amount: number; count: number }> = {};
  for (const o of orders) {
    const d = new Date(o.createdAt);
    const monthKey = d.toLocaleString("default", { month: "short", year: "numeric" });
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = { amount: 0, count: 0 };
    }
    monthMap[monthKey].amount += o.totalAmount || 0;
    monthMap[monthKey].count += 1;
  }

  const recentMonthsSpending = Object.entries(monthMap).map(([month, data]) => ({
    month,
    amount: data.amount,
    orderCount: data.count,
  }));

  return {
    totalSpent,
    orderCount,
    averageOrderValue,
    monthlyBudget: budgetDoc?.monthlyBudget || undefined,
    categorySpending,
    recentMonthsSpending,
  };
}

export async function getShoppingGoals(userId: string): Promise<CustomerGoalSummary[]> {
  try {
    const goals = await ShoppingGoal.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();
    return goals.map((g: any) => ({
      id: g._id?.toString() || "",
      title: g.title,
      category: g.category,
      targetBudget: g.targetBudget,
      currentAmount: g.currentAmount,
      progressPercentage: g.progressPercentage || 0,
      status: g.status,
    }));
  } catch {
    return [];
  }
}

export async function getProductLifecycles(userId: string): Promise<CustomerLifecycleSummary[]> {
  try {
    const lifecycles = await ProductLifecycle.find({ userId }).sort({ purchaseDate: -1 }).limit(10).lean();
    return lifecycles.map((l: any) => ({
      id: l._id?.toString() || "",
      productTitle: l.productTitle,
      category: l.category,
      purchaseDate: l.purchaseDate,
      warrantyExpiryDate: l.warrantyExpiryDate,
      usagePercentage: l.usagePercentage || 0,
      status: l.status,
    }));
  } catch {
    return [];
  }
}

export async function getShoppingJourneys(userId: string) {
  try {
    const journeys = await ShoppingJourney.find({ userId }).sort({ updatedAt: -1 }).limit(5).lean();
    return journeys.map((j: any) => ({
      category: j.category,
      currentStage: j.currentStage,
      journeyProgress: j.journeyProgress,
      eventsCount: j.events?.length || 0,
      recommendedNextCategory: j.recommendedNextCategory,
    }));
  } catch {
    return [];
  }
}

export async function getWishlist(userId: string): Promise<CustomerWishlistItem[]> {
  const wishlist = await Wishlist.findOne({ userId }).lean();
  if (!wishlist || !wishlist.items.length) return [];
  const productIds = wishlist.items.map((i: any) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));
  return wishlist.items
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
    .filter(Boolean) as CustomerWishlistItem[];
}

export async function getCart(userId: string): Promise<CustomerCartItem[]> {
  const cart = await Cart.findOne({ userId }).lean();
  if (!cart || !cart.items.length) return [];
  const productIds = cart.items.map((i: any) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));
  return cart.items
    .map((i: any) => {
      const p = productMap.get(i.productId);
      if (!p) return null;
      return {
        productId: i.productId,
        title: p.title,
        price: p.price,
        quantity: i.quantity,
        image: p.images?.[0],
        stock: p.stock || 0,
      };
    })
    .filter(Boolean) as CustomerCartItem[];
}

export async function getCustomerReviews(userId: string): Promise<Array<{ productId: string; productTitle: string; rating: number; comment: string; at: Date }>> {
  const reviews = await Review.find({ userId }).sort({ createdAt: -1 }).lean();
  const productIds = reviews.map((r: any) => r.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p.title]));
  return reviews.map((r: any) => ({
    productId: r.productId,
    productTitle: productMap.get(r.productId) || "Unknown Product",
    rating: r.rating,
    comment: r.comment,
    at: r.createdAt,
  }));
}

export async function getNotifications(userId: string, limit = 10) {
  const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return notifications.map((n: any) => ({
    id: n._id?.toString() || "",
    title: n.title,
    message: n.message,
    type: n.type,
    isRead: n.isRead,
    createdAt: n.createdAt,
    link: n.link,
  }));
}

export async function getDeals() {
  const coupons = await Coupon.find({ isActive: true, approvalStatus: "approved" }).sort({ createdAt: -1 }).limit(10).lean();
  return coupons.map((c: any) => ({
    id: c._id?.toString() || "",
    code: c.code,
    type: c.type,
    value: c.value,
    minPurchase: c.minPurchase,
    scope: c.scope,
  }));
}

export async function getReturns(userId: string) {
  const orders = await Order.find({ userId, status: { $in: ["returned", "refunded"] } }).sort({ createdAt: -1 }).lean();
  return orders.map((o: any) => ({
    id: o._id?.toString() || "",
    status: o.status,
    totalAmount: o.totalAmount,
    createdAt: o.createdAt,
    items: (o.items || []).map((it: any) => ({ productId: it.productId, title: it.title, price: it.price })),
  }));
}

export async function getRefunds(userId: string) {
  const orders = await Order.find({ userId, paymentStatus: "refunded" }).sort({ createdAt: -1 }).lean();
  return orders.map((o: any) => ({
    id: o._id?.toString() || "",
    status: o.status,
    totalAmount: o.totalAmount,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt,
  }));
}

export async function searchProducts(query: string, budgetMax?: number, category?: string) {
  const filter = await buildPublicProductFilter({});
  if (budgetMax) filter.price = { $lte: budgetMax };
  if (category) filter.category = category;
  const textSearch = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (textSearch.length > 0) {
    filter.$text = { $search: textSearch };
  }
  let products = await Product.find(filter).sort({ ratingAvg: -1, sold: -1 }).limit(8).lean();
  if (products.length === 0) {
    const fallback = await buildPublicProductFilter({});
    if (budgetMax) fallback.price = { $lte: budgetMax };
    products = await Product.find(fallback).sort({ ratingAvg: -1 }).limit(8).lean();
  }
  return products.map((p: any) => ({
    id: p._id?.toString() || "",
    title: p.title,
    price: p.price,
    discountPrice: p.discountPrice,
    category: p.category,
    ratingAvg: p.ratingAvg || 0,
    ratingCount: p.ratingCount || 0,
    stock: p.stock || 0,
    sold: p.sold || 0,
    images: p.images || [],
  }));
}

export async function getProductDetails(productId: string): Promise<ProductDetails | null> {
  const product = await getPublicProduct(productId);
  if (!product) return null;
  const store = await Store.findOne({ ownerId: product.sellerId }).lean();
  return {
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
    specifications:
      product.specifications instanceof Map
        ? Object.fromEntries(product.specifications)
        : { ...(product.specifications || {}) },
    seller: {
      storeName: store?.storeName || "Unknown",
      trustScore: store?.trustScore || 0,
    },
  };
}

export async function getProductReviews(productId: string) {
  const reviews = await Review.find({ productId }).sort({ createdAt: -1 }).limit(20).lean();
  return reviews.map((r: any) => ({
    id: r._id?.toString() || "",
    rating: r.rating,
    comment: r.comment,
    userName: r.userName,
    verifiedPurchase: r.verifiedPurchase,
    createdAt: r.createdAt,
  }));
}

export async function getPurchaseHistoryForReasoning(userId: string) {
  const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();
  const productIds = orders.flatMap((o: any) => (o.items || []).map((it: any) => it.productId));
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));

  return orders.map((o: any) => ({
    id: o._id?.toString() || "",
    status: o.status,
    totalAmount: o.totalAmount,
    createdAt: o.createdAt,
    items: (o.items || []).map((it: any) => {
      const product = productMap.get(it.productId);
      return {
        productId: it.productId,
        title: it.title,
        price: it.price,
        quantity: it.quantity,
        category: product?.category || "",
      };
    }),
  }));
}
