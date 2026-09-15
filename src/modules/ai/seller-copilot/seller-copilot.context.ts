import { SellerCopilotIntent, SellerCopilotMetric, SellerCopilotInsight, SellerCopilotSource, TimeRange } from "./seller-copilot.types";
import {
  getSellerOverview,
  getSellerRevenue,
  getTopProducts,
  getLowPerformingProducts,
  getLowStockProducts,
  getOutOfStockProducts,
  getInventoryData,
  getCategoryPerformance,
  getCustomerData,
  getCustomerReviews,
  getReturnAnalytics,
  getCouponPerformance,
  getRecentActivity,
  getStoreAnalytics,
  getConversionData,
  getPendingOrders,
  getCompletedOrders,
  getCancelledOrders,
  getReturnedOrders,
  getSellerSalesDropAnalysis,
  getSellerForecast,
  getTodaysBusinessBrief,
} from "./seller-copilot.tools";

export interface BuiltContext {
  intent: SellerCopilotIntent;
  timeRange: TimeRange;
  sections: ContextSection[];
  sources: SellerCopilotSource[];
}

export interface ContextSection {
  title: string;
  metrics?: SellerCopilotMetric[];
  insights?: SellerCopilotInsight[];
  data?: unknown;
}

export async function buildCopilotContext(intent: SellerCopilotIntent, timeRange: TimeRange, userId: string): Promise<BuiltContext> {
  const sections: ContextSection[] = [];
  const sources: SellerCopilotSource[] = [];

  switch (intent) {
    case SellerCopilotIntent.STORE_OVERVIEW: {
      const overview = await getSellerOverview(userId);
      sources.push({ name: "Seller Database", type: "database" });
      sections.push({
        title: "Store Overview",
        metrics: [
          { label: "Store Name", value: 0, formatted: overview.storeName },
          { label: "Trust Score", value: overview.trustScore, formatted: `${overview.trustScore}/100` },
          { label: "Total Products", value: overview.totalProducts, formatted: overview.totalProducts.toLocaleString() },
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Total Revenue", value: overview.totalRevenue, formatted: `৳${overview.totalRevenue.toLocaleString()}` },
          { label: "Delivered Orders", value: overview.deliveredOrders, formatted: overview.deliveredOrders.toLocaleString() },
          { label: "Pending Orders", value: overview.pendingOrders, formatted: overview.pendingOrders.toLocaleString() },
          { label: "Returned Orders", value: overview.returnedOrders, formatted: overview.returnedOrders.toLocaleString() },
          { label: "Avg Order Value", value: overview.avgOrderValue, formatted: `৳${overview.avgOrderValue.toLocaleString()}` },
        ],
        data: overview,
      });
      break;
    }

    case SellerCopilotIntent.REVENUE_ANALYSIS: {
      const revenue = await getSellerRevenue(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Revenue Analytics", type: "database", recordCount: revenue.totalRevenue });
      sections.push({
        title: "Revenue Metrics",
        metrics: [
          { label: "Revenue", value: revenue.totalRevenue, formatted: `৳${revenue.totalRevenue.toLocaleString()}`, changePercent: revenue.revenueChangePercent, trend: revenue.revenueChangePercent && revenue.revenueChangePercent < 0 ? "down" : "up" },
          { label: "Avg Order Value", value: revenue.avgOrderValue, formatted: `৳${revenue.avgOrderValue.toLocaleString()}` },
          { label: "Discount Amount", value: revenue.discountAmount, formatted: `৳${revenue.discountAmount.toLocaleString()}` },
          { label: "Refund Amount", value: revenue.refundAmount, formatted: `৳${revenue.refundAmount.toLocaleString()}` },
          { label: "Cancelled Value", value: revenue.cancelledValue, formatted: `৳${revenue.cancelledValue.toLocaleString()}` },
        ],
        data: revenue,
      });
      if (revenue.revenueChangePercent !== undefined && revenue.revenueChangePercent < 0) {
        sections.push({
          title: "Revenue Trend",
          insights: [{
            severity: revenue.revenueChangePercent < -10 ? "high" : "medium",
            title: "Revenue Decline",
            description: `Revenue decreased by ${Math.abs(revenue.revenueChangePercent)}% compared to the previous period`,
            evidence: [
              { fact: "Current revenue", value: `৳${revenue.totalRevenue.toLocaleString()}` },
              { fact: "Previous revenue", value: `৳${(revenue.previousRevenue || 0).toLocaleString()}` },
            ],
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.SALES_ANALYSIS: {
      const topProducts = await getTopProducts(userId, 5);
      const salesData = await getStoreAnalytics(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Sales Analytics", type: "database" });
      sections.push({
        title: "Sales Performance",
        metrics: [
          { label: "Period Revenue", value: salesData.totalRevenue, formatted: `৳${salesData.totalRevenue.toLocaleString()}` },
          { label: "Orders", value: salesData.orderCount, formatted: salesData.orderCount.toLocaleString() },
          { label: "Avg Order Value", value: salesData.avgOrderValue, formatted: `৳${salesData.avgOrderValue.toLocaleString()}` },
        ],
        data: { topProducts, salesData },
      });
      if (topProducts.length > 0) {
        sections.push({
          title: "Top Products",
          metrics: topProducts.map((p) => ({
            label: p.title,
            value: p.revenue,
            formatted: `৳${p.revenue.toLocaleString()} (${p.sold} sold)`,
          })),
          data: topProducts,
        });
      }
      break;
    }

    case SellerCopilotIntent.ORDER_ANALYSIS: {
      const pending = await getPendingOrders(userId);
      const completed = await getCompletedOrders(userId, timeRange.start, timeRange.end);
      const cancelled = await getCancelledOrders(userId, timeRange.start, timeRange.end);
      const returned = await getReturnedOrders(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Order Database", type: "database" });
      sections.push({
        title: "Order Metrics",
        metrics: [
          { label: "Completed", value: completed.length, formatted: completed.length.toLocaleString() },
          { label: "Pending", value: pending.length, formatted: pending.length.toLocaleString() },
          { label: "Cancelled", value: cancelled.length, formatted: cancelled.length.toLocaleString() },
          { label: "Returned", value: returned.length, formatted: returned.length.toLocaleString() },
        ],
        data: { pending: pending.slice(0, 5), completed: completed.slice(0, 5) },
      });
      if (pending.length > 0) {
        sections.push({
          title: "Attention Required",
          insights: [{
            severity: pending.length > 5 ? "high" : "medium",
            title: "Pending Orders",
            description: `${pending.length} orders are awaiting fulfillment.`,
            evidence: pending.slice(0, 3).map((o: any) => ({ fact: `Order ${o._id?.toString().slice(-6)}`, value: o.status })),
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.PRODUCT_ANALYSIS: {
      const top = await getTopProducts(userId, 5);
      const lowPerf = await getLowPerformingProducts(userId);
      sources.push({ name: "Product Analytics", type: "database" });
      sections.push({
        title: "Product Performance",
        metrics: top.map((p) => ({
          label: p.title,
          value: p.revenue,
          formatted: `৳${p.revenue.toLocaleString()} | ${p.sold} sold | stock ${p.stock}`,
        })),
        data: { topProducts: top, lowPerforming: lowPerf },
      });
      if (lowPerf.length > 0) {
        sections.push({
          title: "Low Performing Products",
          insights: [{
            severity: "medium",
            title: "Products with Low Sales",
            description: `${lowPerf.length} products have sold 1 or fewer units. Consider reviewing pricing or promotion.`,
            evidence: lowPerf.slice(0, 3).map((p) => ({ fact: p.title, value: `${p.sold} sold` })),
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.INVENTORY_ANALYSIS: {
      const inventory = await getInventoryData(userId);
      const lowStock = await getLowStockProducts(userId);
      const outOfStock = await getOutOfStockProducts(userId);
      sources.push({ name: "Inventory Database", type: "database" });
      sections.push({
        title: "Inventory Status",
        metrics: [
          { label: "Total Products", value: inventory.totalProducts, formatted: inventory.totalProducts.toLocaleString() },
          { label: "Healthy Stock", value: inventory.healthyStock, formatted: inventory.healthyStock.toLocaleString() },
          { label: "Low Stock", value: inventory.lowStock, formatted: inventory.lowStock.toLocaleString() },
          { label: "Out of Stock", value: inventory.outOfStock, formatted: inventory.outOfStock.toLocaleString() },
        ],
        data: inventory,
      });
      if (outOfStock.length > 0) {
        sections.push({
          title: "Restock Urgency",
          insights: [{
            severity: "high",
            title: "Out of Stock",
            description: `${outOfStock.length} products are completely out of stock and cannot receive orders.`,
            evidence: outOfStock.slice(0, 3).map((p) => ({ fact: p.title, value: "0 stock" })),
          }],
        });
      } else if (lowStock.length > 0) {
        sections.push({
          title: "Restock Warning",
          insights: [{
            severity: "medium",
            title: "Low Stock Alert",
            description: `${lowStock.length} products have 10 or fewer units remaining.`,
            evidence: lowStock.slice(0, 3).map((p) => ({ fact: p.title, value: `${p.stock} left` })),
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.CUSTOMER_ANALYSIS: {
      const customers = await getCustomerData(userId);
      sources.push({ name: "Customer Analytics", type: "database" });
      sections.push({
        title: "Customer Insights",
        metrics: [
          { label: "Unique Buyers", value: customers.length, formatted: customers.length.toLocaleString() },
          { label: "Top Buyer Spent", value: customers[0]?.totalSpent || 0, formatted: `৳${(customers[0]?.totalSpent || 0).toLocaleString()}` },
        ],
        data: { customers: customers.slice(0, 10) },
      });
      break;
    }

    case SellerCopilotIntent.REVIEW_ANALYSIS: {
      const reviews = await getCustomerReviews(userId, 20);
      sources.push({ name: "Review Database", type: "database" });
      sections.push({
        title: "Review Summary",
        metrics: [
          { label: "Total Reviews", value: reviews.total, formatted: reviews.total.toLocaleString() },
          { label: "Avg Rating", value: reviews.avgRating, formatted: `${reviews.avgRating}/5` },
          { label: "Positive", value: reviews.positiveCount, formatted: reviews.positiveCount.toLocaleString() },
          { label: "Negative", value: reviews.negativeCount, formatted: reviews.negativeCount.toLocaleString() },
        ],
        data: reviews,
      });
      if (reviews.negativeCount > 0) {
        sections.push({
          title: "Negative Reviews",
          insights: [{
            severity: reviews.negativeCount > 5 ? "high" : "medium",
            title: "Negative Feedback",
            description: `${reviews.negativeCount} reviews have ratings of 2 or lower.`,
            evidence: reviews.recent.filter((r) => r.rating <= 2).slice(0, 3).map((r) => ({ fact: r.productTitle, value: `${r.rating}/5` })),
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.RETURN_ANALYSIS: {
      const returns = await getReturnAnalytics(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Return Analytics", type: "database" });
      sections.push({
        title: "Return & Refund Metrics",
        metrics: [
          { label: "Returned Orders", value: returns.totalReturned, formatted: returns.totalReturned.toLocaleString() },
          { label: "Return Rate", value: returns.returnRatePercent, formatted: `${returns.returnRatePercent}%` },
          { label: "Returned Value", value: returns.returnedValue, formatted: `৳${returns.returnedValue.toLocaleString()}` },
          { label: "Refunded Value", value: returns.refundedValue, formatted: `৳${returns.refundedValue.toLocaleString()}` },
        ],
        data: returns,
      });
      if (returns.returnRatePercent > 5) {
        sections.push({
          title: "Return Risk",
          insights: [{
            severity: "high",
            title: "High Return Rate",
            description: `Return rate is ${returns.returnRatePercent}%. Investigate product quality or descriptions.`,
            evidence: returns.byProduct.slice(0, 3).map((p) => ({ fact: p.title, value: `${p.returnCount} returns` })),
          }],
        });
      }
      break;
    }

    case SellerCopilotIntent.CATEGORY_ANALYSIS: {
      const categories = await getCategoryPerformance(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Category Analytics", type: "database" });
      sections.push({
        title: "Category Performance",
        metrics: categories.slice(0, 5).map((c) => ({
          label: c.name,
          value: c.revenue,
          formatted: `৳${c.revenue.toLocaleString()} (${c.sharePercent}%)`,
        })),
        data: categories,
      });
      break;
    }

    case SellerCopilotIntent.FORECAST_ANALYSIS: {
      const forecast = await getSellerForecast(userId);
      sources.push({ name: "Sales Forecast", type: "analytics" });
      if (forecast.confidence === "insufficient") {
        sections.push({
          title: "Sales Forecast",
          insights: [{
            severity: "info",
            title: "Insufficient Data",
            description: forecast.message || "Insufficient historical data for a reliable forecast.",
            evidence: [],
          }],
          data: forecast,
        });
      } else {
        sections.push({
          title: "Sales Forecast",
          metrics: [
            { label: "Forecast Revenue", value: forecast.forecastRevenue, formatted: `৳${(forecast.forecastRevenue || 0).toLocaleString()}` },
            { label: "Forecast Orders", value: forecast.forecastOrders, formatted: (forecast.forecastOrders || 0).toLocaleString() },
            { label: "Baseline", value: forecast.baseline || 0, formatted: `৳${(forecast.baseline || 0).toLocaleString()}` },
            { label: "Trend", value: 0, formatted: `${(forecast.trend || 0) >= 0 ? "+" : ""}${forecast.trend || 0}%` },
          ],
          insights: [{
            severity: (forecast.confidence === "high" ? "info" : "medium") as "info" | "medium",
            title: `Forecast Confidence: ${forecast.confidence || "low"}`,
            description: `${forecast.method || "unknown"} based on ${(forecast.dataWindow || "unknown").replace("_", " ")}. ${forecast.risks || ""}`,
            evidence: [
              { fact: "Method", value: (forecast.method || "unknown").replace(/_/g, " ") },
              { fact: "Data window", value: (forecast.dataWindow || "unknown").replace(/_/g, " ") },
            ],
          }],
          data: forecast,
        });
      }
      break;
    }

    case SellerCopilotIntent.ROOT_CAUSE_ANALYSIS: {
      const dropAnalysis = await getSellerSalesDropAnalysis(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Sales Analytics", type: "database" });
      sections.push({
        title: "Sales Change Analysis",
        metrics: [
          { label: "Current Revenue", value: dropAnalysis.currentPeriod.revenue, formatted: `৳${dropAnalysis.currentPeriod.revenue.toLocaleString()}`, changePercent: dropAnalysis.revenueChangePercent, trend: dropAnalysis.revenueChangePercent < 0 ? "down" : "up" },
          { label: "Previous Revenue", value: dropAnalysis.previousPeriod.revenue, formatted: `৳${dropAnalysis.previousPeriod.revenue.toLocaleString()}` },
          { label: "Current Orders", value: dropAnalysis.currentPeriod.orders, formatted: dropAnalysis.currentPeriod.orders.toLocaleString(), changePercent: dropAnalysis.orderChangePercent, trend: dropAnalysis.orderChangePercent < 0 ? "down" : "up" },
          { label: "Previous Orders", value: dropAnalysis.previousPeriod.orders, formatted: dropAnalysis.previousPeriod.orders.toLocaleString() },
        ],
        data: dropAnalysis,
      });
      if (dropAnalysis.decliningProducts.length > 0) {
        sections.push({
          title: "Declining Products",
          insights: [{
            severity: dropAnalysis.revenueChangePercent < -20 ? "high" : "medium",
            title: `Revenue ${dropAnalysis.revenueChangePercent < 0 ? "Decrease" : "Increase"} of ${Math.abs(dropAnalysis.revenueChangePercent)}%`,
            description: dropAnalysis.revenueChangePercent < 0
              ? `${dropAnalysis.decliningProducts.length} products show significant revenue decline.`
              : `Revenue increased. ${dropAnalysis.decliningProducts.length} products still underperforming.`,
            evidence: dropAnalysis.decliningProducts.slice(0, 3).map((p) => ({ fact: p.title, value: `${p.changePercent}%` })),
          }],
        });
      }
      if (dropAnalysis.outOfStockProducts.length > 0) {
        sections.push({
          title: "Stock Issues",
          insights: [{
            severity: "high",
            title: "Out of Stock Impact",
            description: `${dropAnalysis.outOfStockProducts.length} products were out of stock during the period, which may have limited sales.`,
            evidence: dropAnalysis.outOfStockProducts.slice(0, 3).map((p) => ({ fact: p.title, value: "0 stock" })),
          }],
        });
      }
      sections.push({
        title: "Analysis Confidence",
        insights: [{
          severity: "info",
          title: `Confidence: ${dropAnalysis.confidence}`,
          description: dropAnalysis.confidence === "low" ? "Limited order history for this period. Consider expanding the time window for more reliable analysis." : "Sufficient data for analysis.",
          evidence: [{ fact: "Current orders", value: dropAnalysis.currentPeriod.orders.toString() }],
        }],
      });
      break;
    }

    case SellerCopilotIntent.RECOMMENDATION: {
      const [overview, lowStock, outOfStock, lowPerf, dropAnalysis] = await Promise.all([
        getSellerOverview(userId),
        getLowStockProducts(userId),
        getOutOfStockProducts(userId),
        getLowPerformingProducts(userId),
        getSellerSalesDropAnalysis(userId, timeRange.start, timeRange.end),
      ]);
      sources.push({ name: "Recommendation Engine", type: "database" });
      const recommendations: string[] = [];
      if (outOfStock.length > 0) recommendations.push(`Restock ${outOfStock.length} out-of-stock products immediately to recover lost sales.`);
      if (lowStock.length > 0) recommendations.push(`Consider restocking ${lowStock.length} low-stock products (10 or fewer units).`);
      if (lowPerf.length > 0) recommendations.push(`Review pricing or promotion strategy for ${lowPerf.length} low-performing products.`);
      if (overview.pendingOrders > 0) recommendations.push(`Fulfill ${overview.pendingOrders} pending orders quickly to maintain customer trust.`);
      if (dropAnalysis.decliningProducts.length > 0) {
        recommendations.push(`Investigate declining products: ${dropAnalysis.decliningProducts.slice(0, 2).map((p) => p.title).join(", ")}.`);
      }
      if (recommendations.length === 0) {
        recommendations.push("No critical actions identified. Continue monitoring performance.");
      }
      sections.push({
        title: "Priority Actions",
        insights: recommendations.map((r) => ({
          severity: "info" as const,
          title: "Action",
          description: r,
        })),
        data: { recommendations },
      });
      break;
    }

    case SellerCopilotIntent.TREND_ANALYSIS: {
      const sales = await getStoreAnalytics(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Trend Analytics", type: "database" });
      sections.push({
        title: "Trend Analysis",
        metrics: [
          { label: "Period Revenue", value: sales.totalRevenue, formatted: `৳${sales.totalRevenue.toLocaleString()}` },
          { label: "Orders", value: sales.orderCount, formatted: sales.orderCount.toLocaleString() },
        ],
        data: sales,
      });
      break;
    }

    case SellerCopilotIntent.COMPARISON: {
      const revenue = await getSellerRevenue(userId, timeRange.start, timeRange.end);
      const analytics = await getStoreAnalytics(userId, timeRange.start, timeRange.end);
      sources.push({ name: "Comparison Analytics", type: "database" });
      sections.push({
        title: "Period Comparison",
        metrics: [
          { label: "Current Period Revenue", value: revenue.totalRevenue, formatted: `৳${revenue.totalRevenue.toLocaleString()}`, changePercent: revenue.revenueChangePercent, trend: revenue.revenueChangePercent && revenue.revenueChangePercent < 0 ? "down" : "up" },
          { label: "Previous Period Revenue", value: revenue.previousRevenue || 0, formatted: `৳${(revenue.previousRevenue || 0).toLocaleString()}` },
          { label: "Current Orders", value: analytics.orderCount, formatted: analytics.orderCount.toLocaleString() },
        ],
        data: { revenue, analytics },
      });
      break;
    }

    default: {
      const overview = await getSellerOverview(userId);
      sources.push({ name: "Seller Database", type: "database" });
      sections.push({
        title: "Store Overview",
        metrics: [
          { label: "Store Name", value: 0, formatted: overview.storeName },
          { label: "Trust Score", value: overview.trustScore, formatted: `${overview.trustScore}/100` },
          { label: "Total Products", value: overview.totalProducts, formatted: overview.totalProducts.toLocaleString() },
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Total Revenue", value: overview.totalRevenue, formatted: `৳${overview.totalRevenue.toLocaleString()}` },
        ],
        data: overview,
      });
      break;
    }
  }

  return { intent, timeRange, sections, sources };
}
