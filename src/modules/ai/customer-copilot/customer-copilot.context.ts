import { CustomerCopilotIntent, CustomerCopilotMetric, CustomerCopilotInsight, CustomerCopilotSource, TimeRange } from "./customer-copilot.types";
import {
  getCustomerOverview,
  getCustomerOrders,
  getActiveOrders,
  getWishlist,
  getCart,
  getCustomerReviews,
  getNotifications,
  getDeals,
  getReturns,
  getRefunds,
  searchProducts,
  getProductDetails,
  getProductReviews,
  getSellerInfo,
  getAccessoryRecommendations,
  getPurchaseHistoryForReasoning,
} from "./customer-copilot.tools";

export interface BuiltContext {
  intent: CustomerCopilotIntent;
  timeRange: TimeRange;
  sections: ContextSection[];
  sources: CustomerCopilotSource[];
}

export interface ContextSection {
  title: string;
  metrics?: CustomerCopilotMetric[];
  insights?: CustomerCopilotInsight[];
  data?: unknown;
}

export async function buildCopilotContext(intent: CustomerCopilotIntent, timeRange: TimeRange, userId: string): Promise<BuiltContext> {
  const sections: ContextSection[] = [];
  const sources: CustomerCopilotSource[] = [];

  switch (intent) {
    case CustomerCopilotIntent.GENERAL_CHAT: {
      const overview = await getCustomerOverview(userId);
      sources.push({ name: "Customer Database", type: "database" });
      sections.push({
        title: "Your Shopping Summary",
        metrics: [
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Active Orders", value: overview.activeOrders, formatted: overview.activeOrders.toLocaleString() },
          { label: "Wishlist Items", value: overview.wishlistCount, formatted: overview.wishlistCount.toLocaleString() },
          { label: "Cart Items", value: overview.cartCount, formatted: overview.cartCount.toLocaleString() },
          { label: "Total Spent", value: overview.totalSpent, formatted: `৳${overview.totalSpent.toLocaleString()}` },
        ],
        data: overview,
      });
      break;
    }

    case CustomerCopilotIntent.ORDER_STATUS: {
      const activeOrders = await getActiveOrders(userId);
      sources.push({ name: "Order Database", type: "database" });
      sections.push({
        title: "Active Orders",
        metrics: activeOrders.slice(0, 5).map((o) => ({
          label: `Order ${o.id.slice(-6)}`,
          value: o.totalAmount,
          formatted: `৳${o.totalAmount} | ${o.status}`,
        })),
        data: { orders: activeOrders.slice(0, 5) },
      });
      break;
    }

    case CustomerCopilotIntent.ORDER_HISTORY: {
      const orders = await getCustomerOrders(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Order History", type: "database" });
      sections.push({
        title: "Order History",
        metrics: [
          { label: "Orders in Period", value: orders.length, formatted: orders.length.toLocaleString() },
          { label: "Total Spent", value: orders.reduce((sum, o) => sum + o.totalAmount, 0), formatted: `৳${orders.reduce((sum, o) => sum + o.totalAmount, 0).toLocaleString()}` },
        ],
        data: { orders: orders.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.WISHLIST: {
      const wishlist = await getWishlist(userId);
      sources.push({ name: "Wishlist", type: "database" });
      sections.push({
        title: "Your Wishlist",
        metrics: [
          { label: "Items", value: wishlist.length, formatted: wishlist.length.toLocaleString() },
        ],
        data: { items: wishlist.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.CART: {
      const cart = await getCart(userId);
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      sources.push({ name: "Cart", type: "database" });
      sections.push({
        title: "Your Cart",
        metrics: [
          { label: "Items", value: cart.length, formatted: cart.length.toLocaleString() },
          { label: "Subtotal", value: subtotal, formatted: `৳${subtotal.toLocaleString()}` },
        ],
        data: { items: cart.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.REVIEW: {
      const reviews = await getCustomerReviews(userId);
      const avgRating = reviews.length > 0 ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)) : 0;
      sources.push({ name: "Review Database", type: "database" });
      sections.push({
        title: "Your Reviews",
        metrics: [
          { label: "Reviews Written", value: reviews.length, formatted: reviews.length.toLocaleString() },
          { label: "Avg Rating", value: avgRating, formatted: `${avgRating}/5` },
        ],
        data: { reviews: reviews.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.RETURN:
    case CustomerCopilotIntent.REFUND: {
      const returns = await getReturns(userId);
      const refunds = await getRefunds(userId);
      sources.push({ name: "Returns & Refunds", type: "database" });
      sections.push({
        title: "Returns & Refunds",
        metrics: [
          { label: "Returns", value: returns.length, formatted: returns.length.toLocaleString() },
          { label: "Refunds", value: refunds.length, formatted: refunds.length.toLocaleString() },
        ],
        data: { returns, refunds },
      });
      break;
    }

    case CustomerCopilotIntent.DEAL: {
      const deals = await getDeals(userId);
      sources.push({ name: "Coupons & Deals", type: "database" });
      sections.push({
        title: "Available Deals",
        metrics: deals.slice(0, 5).map((d) => ({
          label: d.code,
          value: d.value,
          formatted: `${d.type === "percentage" ? d.value + "%" : "৳" + d.value} off`,
        })),
        data: { deals: deals.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.NOTIFICATION: {
      const notifications = await getNotifications(userId, 10);
      const unread = notifications.filter((n) => !n.isRead).length;
      sources.push({ name: "Notifications", type: "database" });
      sections.push({
        title: "Notifications",
        metrics: [
          { label: "Total", value: notifications.length, formatted: notifications.length.toLocaleString() },
          { label: "Unread", value: unread, formatted: unread.toLocaleString() },
        ],
        data: { notifications },
      });
      break;
    }

    case CustomerCopilotIntent.PRODUCT_DISCOVERY: {
      const recentPurchases = await getPurchaseHistoryForReasoning(userId);
      sources.push({ name: "Product Catalog", type: "database" });
      sections.push({
        title: "Product Discovery",
        data: { recentPurchases, accessoryRecommendations: null },
      });
      break;
    }

    case CustomerCopilotIntent.RECOMMENDATION: {
      const overview = await getCustomerOverview(userId);
      const recentPurchases = await getPurchaseHistoryForReasoning(userId);
      const accessoryRecs = await getAccessoryRecommendations(userId);
      sources.push({ name: "Recommendation Engine", type: "database" });
      sections.push({
        title: "Recommendations",
        data: { overview, recentPurchases, accessoryRecommendations: accessoryRecs },
      });
      break;
    }

    case CustomerCopilotIntent.SHOPPING_GOAL: {
      const recentPurchases = await getPurchaseHistoryForReasoning(userId);
      const accessoryRecs = await getAccessoryRecommendations(userId);
      const wishlist = await getWishlist(userId);
      sources.push({ name: "Shopping Goal Engine", type: "database" });
      sections.push({
        title: "Shopping Goal Analysis",
        data: { recentPurchases, accessoryRecommendations: accessoryRecs, wishlist },
      });
      break;
    }

    case CustomerCopilotIntent.PRODUCT_COMPARISON: {
      const wishlist = await getWishlist(userId);
      const recentPurchases = await getPurchaseHistoryForReasoning(userId);
      sources.push({ name: "Product Comparison Engine", type: "database" });
      sections.push({
        title: "Product Comparison Context",
        data: { wishlist, recentPurchases },
      });
      break;
    }

    case CustomerCopilotIntent.TRACKING: {
      const activeOrders = await getActiveOrders(userId);
      const notifications = await getNotifications(userId, 10);
      sources.push({ name: "Order Tracking", type: "database" });
      sections.push({
        title: "Tracking & Delivery",
        metrics: [
          { label: "Active Orders", value: activeOrders.length, formatted: activeOrders.length.toLocaleString() },
          { label: "Notifications", value: notifications.length, formatted: notifications.length.toLocaleString() },
        ],
        data: { activeOrders: activeOrders.slice(0, 5), notifications: notifications.slice(0, 5) },
      });
      break;
    }

    case CustomerCopilotIntent.BUDGET: {
      const overview = await getCustomerOverview(userId);
      const orders = await getCustomerOrders(userId, timeRange.start, timeRange.end);
      const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);
      sources.push({ name: "Spending Analytics", type: "database" });
      sections.push({
        title: "Budget Analysis",
        metrics: [
          { label: "Total Spent (Period)", value: totalSpent, formatted: `৳${totalSpent.toLocaleString()}` },
          { label: "Orders (Period)", value: orders.length, formatted: orders.length.toLocaleString() },
          { label: "Avg Order Value", value: orders.length > 0 ? Math.round(totalSpent / orders.length) : 0, formatted: `৳${orders.length > 0 ? Math.round(totalSpent / orders.length) : 0}` },
        ],
        data: { overview, orders: orders.slice(0, 10) },
      });
      break;
    }

    default: {
      const overview = await getCustomerOverview(userId);
      sources.push({ name: "Customer Database", type: "database" });
      sections.push({
        title: "Your Shopping Summary",
        metrics: [
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Active Orders", value: overview.activeOrders, formatted: overview.activeOrders.toLocaleString() },
          { label: "Wishlist", value: overview.wishlistCount, formatted: overview.wishlistCount.toLocaleString() },
          { label: "Total Spent", value: overview.totalSpent, formatted: `৳${overview.totalSpent.toLocaleString()}` },
        ],
        data: overview,
      });
      break;
    }
  }

  return { intent, timeRange, sections, sources };
}
