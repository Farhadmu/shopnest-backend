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
  getCustomerSpendingSummary,
  getShoppingGoals,
  getProductLifecycles,
  getShoppingJourneys,
  searchProducts,
  getProductDetails,
  getProductReviews,
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
      const [overview, spending, activeOrders, wishlist, cart, goals] = await Promise.all([
        getCustomerOverview(userId),
        getCustomerSpendingSummary(userId).catch(() => null),
        getActiveOrders(userId).catch(() => []),
        getWishlist(userId).catch(() => []),
        getCart(userId).catch(() => []),
        getShoppingGoals(userId).catch(() => []),
      ]);

      sources.push({ name: "My ShopNest Central Command", type: "database" });
      sections.push({
        title: "Your Account Snapshot",
        metrics: [
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Active Deliveries", value: overview.activeOrders, formatted: overview.activeOrders.toLocaleString() },
          { label: "Wishlist Items", value: overview.wishlistCount, formatted: overview.wishlistCount.toLocaleString() },
          { label: "Cart Items", value: overview.cartCount, formatted: overview.cartCount.toLocaleString() },
          { label: "Total Spent", value: overview.totalSpent, formatted: `৳${overview.totalSpent.toLocaleString()}` },
          { label: "Loyalty Points", value: overview.loyaltyPoints || 0, formatted: (overview.loyaltyPoints || 0).toLocaleString() },
        ],
        data: { overview, spending, activeOrders: activeOrders.slice(0, 3), wishlist: wishlist.slice(0, 3), cart: cart.slice(0, 3), goals: goals.slice(0, 3) },
      });
      break;
    }

    case CustomerCopilotIntent.ORDER_STATUS:
    case CustomerCopilotIntent.TRACKING: {
      const [activeOrders, pastOrders] = await Promise.all([
        getActiveOrders(userId),
        getCustomerOrders(userId),
      ]);
      sources.push({ name: "Order & Logistics Tracking", type: "database" });

      const metrics: CustomerCopilotMetric[] = [
        { label: "Active Orders", value: activeOrders.length, formatted: activeOrders.length.toLocaleString() },
        { label: "Total Lifetime Orders", value: pastOrders.length, formatted: pastOrders.length.toLocaleString() },
      ];

      sections.push({
        title: "Active Orders & Delivery Live Status",
        metrics,
        data: {
          activeOrders: activeOrders.slice(0, 5),
          latestOrder: pastOrders[0] || null,
        },
      });
      break;
    }

    case CustomerCopilotIntent.ORDER_HISTORY: {
      const orders = await getCustomerOrders(userId, timeRange.start, timeRange.end);
      const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);
      sources.push({ name: "Order History Database", type: "database" });
      sections.push({
        title: "Order History & Purchases",
        metrics: [
          { label: "Orders in Period", value: orders.length, formatted: orders.length.toLocaleString() },
          { label: "Total Spent", value: totalSpent, formatted: `৳${totalSpent.toLocaleString()}` },
          { label: "Average Order Value", value: orders.length > 0 ? Math.round(totalSpent / orders.length) : 0, formatted: `৳${orders.length > 0 ? Math.round(totalSpent / orders.length).toLocaleString() : "0"}` },
        ],
        data: { orders: orders.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.BUDGET: {
      const spending = await getCustomerSpendingSummary(userId);
      sources.push({ name: "Spending Analytics & Budget Engine", type: "database" });
      sections.push({
        title: "Spending Analysis & Breakdown",
        metrics: [
          { label: "Total Spent", value: spending.totalSpent, formatted: `৳${spending.totalSpent.toLocaleString()}` },
          { label: "Orders Placed", value: spending.orderCount, formatted: spending.orderCount.toLocaleString() },
          { label: "Average Order", value: spending.averageOrderValue, formatted: `৳${spending.averageOrderValue.toLocaleString()}` },
          ...(spending.monthlyBudget ? [{ label: "Monthly Budget", value: spending.monthlyBudget, formatted: `৳${spending.monthlyBudget.toLocaleString()}` }] : []),
        ],
        data: { spending },
      });
      break;
    }

    case CustomerCopilotIntent.WISHLIST: {
      const [wishlist, spending] = await Promise.all([
        getWishlist(userId),
        getCustomerSpendingSummary(userId).catch(() => null),
      ]);
      sources.push({ name: "Saved Wishlist Catalog", type: "database" });
      const totalWishlistValue = wishlist.reduce((sum, item) => sum + (item.discountPrice || item.price), 0);
      sections.push({
        title: "Your Wishlist Items",
        metrics: [
          { label: "Saved Items", value: wishlist.length, formatted: wishlist.length.toLocaleString() },
          { label: "Total Value", value: totalWishlistValue, formatted: `৳${totalWishlistValue.toLocaleString()}` },
        ],
        data: { wishlist: wishlist.slice(0, 10), averageSpend: spending?.averageOrderValue },
      });
      break;
    }

    case CustomerCopilotIntent.CART: {
      const cart = await getCart(userId);
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      sources.push({ name: "Smart Cart Database", type: "database" });
      sections.push({
        title: "Your Cart Items & Snapshot",
        metrics: [
          { label: "Cart Items", value: cart.length, formatted: cart.length.toLocaleString() },
          { label: "Cart Subtotal", value: subtotal, formatted: `৳${subtotal.toLocaleString()}` },
        ],
        data: { items: cart.slice(0, 10), subtotal },
      });
      break;
    }

    case CustomerCopilotIntent.SHOPPING_GOAL: {
      const [goals, spending] = await Promise.all([
        getShoppingGoals(userId),
        getCustomerSpendingSummary(userId).catch(() => null),
      ]);
      sources.push({ name: "Shopping Goals Planner", type: "database" });
      sections.push({
        title: "Shopping Goals Progress",
        metrics: [
          { label: "Active Goals", value: goals.length, formatted: goals.length.toLocaleString() },
        ],
        data: { goals, spending },
      });
      break;
    }

    case CustomerCopilotIntent.RETURN:
    case CustomerCopilotIntent.REFUND: {
      const [orders, returns, refunds] = await Promise.all([
        getCustomerOrders(userId),
        getReturns(userId),
        getRefunds(userId),
      ]);
      const eligibleOrders = orders.filter((o) => o.isReturnEligible);
      sources.push({ name: "Returns & Refund Center", type: "database" });
      sections.push({
        title: "Return Eligibility & History",
        metrics: [
          { label: "Return-Eligible Orders", value: eligibleOrders.length, formatted: eligibleOrders.length.toLocaleString() },
          { label: "Past Returns", value: returns.length, formatted: returns.length.toLocaleString() },
          { label: "Refunded Orders", value: refunds.length, formatted: refunds.length.toLocaleString() },
        ],
        data: { eligibleOrders: eligibleOrders.slice(0, 5), returns, refunds },
      });
      break;
    }

    case CustomerCopilotIntent.REVIEW: {
      const reviews = await getCustomerReviews(userId);
      const avgRating = reviews.length > 0 ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)) : 0;
      sources.push({ name: "Reviews Center", type: "database" });
      sections.push({
        title: "Your Submitted Product Reviews",
        metrics: [
          { label: "Reviews Written", value: reviews.length, formatted: reviews.length.toLocaleString() },
          { label: "Avg Rating", value: avgRating, formatted: `${avgRating}/5 ⭐` },
        ],
        data: { reviews: reviews.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.DEAL: {
      const deals = await getDeals();
      sources.push({ name: "Active Coupons & Deals", type: "database" });
      sections.push({
        title: "Available Coupons & Platform Deals",
        metrics: deals.slice(0, 5).map((d) => ({
          label: d.code,
          value: d.value,
          formatted: `${d.type === "percentage" ? d.value + "%" : "৳" + d.value} off (Min: ৳${d.minPurchase})`,
        })),
        data: { deals: deals.slice(0, 10) },
      });
      break;
    }

    case CustomerCopilotIntent.NOTIFICATION: {
      const notifications = await getNotifications(userId, 10);
      const unread = notifications.filter((n) => !n.isRead).length;
      sources.push({ name: "Customer Notification Hub", type: "database" });
      sections.push({
        title: "Your Recent Alerts & Notifications",
        metrics: [
          { label: "Total Notifications", value: notifications.length, formatted: notifications.length.toLocaleString() },
          { label: "Unread Messages", value: unread, formatted: unread.toLocaleString() },
        ],
        data: { notifications },
      });
      break;
    }

    default: {
      const [overview, spending, activeOrders, wishlist] = await Promise.all([
        getCustomerOverview(userId),
        getCustomerSpendingSummary(userId).catch(() => null),
        getActiveOrders(userId).catch(() => []),
        getWishlist(userId).catch(() => []),
      ]);
      sources.push({ name: "Customer Central Database", type: "database" });
      sections.push({
        title: "Your Shopping Summary",
        metrics: [
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Active Orders", value: overview.activeOrders, formatted: overview.activeOrders.toLocaleString() },
          { label: "Wishlist", value: overview.wishlistCount, formatted: overview.wishlistCount.toLocaleString() },
          { label: "Total Spent", value: overview.totalSpent, formatted: `৳${overview.totalSpent.toLocaleString()}` },
        ],
        data: { overview, spending, activeOrders: activeOrders.slice(0, 3), wishlist: wishlist.slice(0, 3) },
      });
      break;
    }
  }

  return { intent, timeRange, sections, sources };
}
