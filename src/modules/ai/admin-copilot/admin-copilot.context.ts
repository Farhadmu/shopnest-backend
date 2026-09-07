import { CopilotIntent, TimeRange, CopilotMetric, CopilotInsight, CopilotSource, CopilotEvidence } from "./admin-copilot.types";
import {
  getMarketplaceOverview,
  getRevenueMetrics,
  getTopSellers,
  getCategoryMetrics,
  getAnomalySummary,
  getSecuritySummary,
  getTelemetrySummary,
  getFinancialRisk,
  getOrderMetrics,
  getCustomerMetrics,
  getProductMetrics,
  getSellerRiskMetrics,
} from "./admin-copilot.tools";

export interface BuiltContext {
  intent: CopilotIntent;
  timeRange: TimeRange;
  sections: ContextSection[];
  sources: CopilotSource[];
}

export interface ContextSection {
  title: string;
  metrics?: CopilotMetric[];
  insights?: CopilotInsight[];
  data?: unknown;
}

export async function buildCopilotContext(
  intent: CopilotIntent,
  timeRange: TimeRange
): Promise<BuiltContext> {
  const sections: ContextSection[] = [];
  const sources: CopilotSource[] = [];

  switch (intent) {
    case CopilotIntent.MARKETPLACE_OVERVIEW:
    case CopilotIntent.EXECUTIVE_SUMMARY:
    case CopilotIntent.PLATFORM_PERFORMANCE: {
      const overview = await getMarketplaceOverview();
      sources.push({ name: "Marketplace Database", type: "database" });

      sections.push({
        title: "Platform Overview",
        metrics: [
          { label: "Total Users", value: overview.totalUsers, formatted: overview.totalUsers.toLocaleString() },
          { label: "Active Sellers", value: overview.approvedSellers, formatted: overview.approvedSellers.toLocaleString() },
          { label: "Total Products", value: overview.totalProducts, formatted: overview.totalProducts.toLocaleString() },
          { label: "Total Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Total Revenue", value: overview.totalRevenue, formatted: `৳${overview.totalRevenue.toLocaleString()}` },
          { label: "Average Order Value", value: overview.averageOrderValue, formatted: `৳${overview.averageOrderValue.toLocaleString()}` },
        ],
        data: overview,
      });

      if (overview.cancelledOrders > 0) {
        const cancelRate = Math.round((overview.cancelledOrders / (overview.totalOrders || 1)) * 1000) / 10;
        sections.push({
          title: "Order Health",
          insights: [{
            severity: cancelRate > 10 ? "high" : cancelRate > 5 ? "medium" : "low",
            title: "Cancellation Rate",
            description: `${cancelRate}% of orders are cancelled`,
            evidence: [{ fact: "Cancelled orders", value: overview.cancelledOrders }, { fact: "Total orders", value: overview.totalOrders }],
          }],
        });
      }
      break;
    }

    case CopilotIntent.REVENUE_ANALYSIS:
    case CopilotIntent.GMV_ANALYSIS: {
      const revenue = await getRevenueMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Revenue Analytics", type: "analytics", period: timeRange.label });

      sections.push({
        title: "Revenue Metrics",
        metrics: [
          { label: "Revenue", value: revenue.totalRevenue, formatted: `৳${revenue.totalRevenue.toLocaleString()}`, changePercent: revenue.revenueChangePercent, trend: revenue.revenueChangePercent && revenue.revenueChangePercent < 0 ? "down" : "up" },
          { label: "GMV", value: revenue.totalGmv, formatted: `৳${revenue.totalGmv.toLocaleString()}` },
          { label: "Average Order Value", value: revenue.averageOrderValue, formatted: `৳${revenue.averageOrderValue.toLocaleString()}` },
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
            evidence: [{ fact: "Current revenue", value: `৳${revenue.totalRevenue.toLocaleString()}` }, { fact: "Previous revenue", value: `৳${(revenue.previousRevenue || 0).toLocaleString()}` }],
          }],
        });
      }
      break;
    }

    case CopilotIntent.SELLER_ANALYSIS:
    case CopilotIntent.SELLER_RISK: {
      const sellers = await getTopSellers(timeRange.start, timeRange.end);
      const riskSellers = await getSellerRiskMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Seller Analytics", type: "analytics", period: timeRange.label });

      sections.push({
        title: "Top Sellers",
        metrics: sellers.slice(0, 5).map((s) => ({
          label: s.storeName,
          value: s.revenue,
          formatted: `৳${s.revenue.toLocaleString()}`,
        })),
        data: { sellers: sellers.slice(0, 10) },
      });

      const highRisk = riskSellers.filter((s) => s.riskLevel === "high").slice(0, 5);
      if (highRisk.length > 0) {
        sections.push({
          title: "High Risk Sellers",
          insights: highRisk.map((s) => ({
            severity: "high" as const,
            title: s.storeName,
            description: `Risk Score: ${s.riskScore}/100`,
            evidence: [{ fact: "Trust Score", value: s.trustScore }, { fact: "Cancellation Rate", value: `${s.cancellationRate}%` }],
          })),
          data: { highRiskSellers: highRisk },
        });
      }
      break;
    }

    case CopilotIntent.CATEGORY_ANALYSIS: {
      const categories = await getCategoryMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Category Analytics", type: "analytics", period: timeRange.label });

      sections.push({
        title: "Category Performance",
        metrics: categories.slice(0, 5).map((c) => ({
          label: c.name,
          value: c.revenue,
          formatted: `৳${c.revenue.toLocaleString()}`,
        })),
        data: { categories },
      });
      break;
    }

    case CopilotIntent.ANOMALY_ANALYSIS: {
      const anomalies = await getAnomalySummary(timeRange.start, timeRange.end);
      sources.push({ name: "Anomaly Center", type: "analytics", period: timeRange.label });

      sections.push({
        title: "Anomaly Summary",
        metrics: [
          { label: "Total Anomalies", value: anomalies.total, formatted: String(anomalies.total) },
          { label: "Critical", value: anomalies.critical, formatted: String(anomalies.critical) },
          { label: "High", value: anomalies.high, formatted: String(anomalies.high) },
        ],
        data: anomalies,
      });
      break;
    }

    case CopilotIntent.SECURITY_ANALYSIS: {
      const security = await getSecuritySummary(timeRange.start, timeRange.end);
      sources.push({ name: "Security Center", type: "security", period: timeRange.label });

      sections.push({
        title: "Security Overview",
        metrics: [
          { label: "Failed Logins", value: security.failedLogins, formatted: String(security.failedLogins) },
          { label: "Open Incidents", value: security.openIncidents, formatted: String(security.openIncidents) },
          { label: "Critical Incidents", value: security.criticalIncidents, formatted: String(security.criticalIncidents) },
          { label: "Suspicious Activities", value: security.suspiciousActivities, formatted: String(security.suspiciousActivities) },
        ],
        data: security,
      });
      break;
    }

    case CopilotIntent.TELEMETRY_ANALYSIS:
    case CopilotIntent.SYSTEM_HEALTH: {
      const telemetry = await getTelemetrySummary();
      sources.push({ name: "System Telemetry", type: "telemetry" });

      sections.push({
        title: "System Telemetry",
        metrics: [
          { label: "Status", value: 1, formatted: telemetry.overallStatus },
          { label: "Uptime", value: 1, formatted: telemetry.uptime },
          { label: "P95 Latency", value: telemetry.p95LatencyMs, formatted: `${telemetry.p95LatencyMs}ms` },
        ],
        data: telemetry,
      });
      break;
    }

    case CopilotIntent.REVENUE_LEAKAGE:
    case CopilotIntent.FRAUD_ANALYSIS: {
      const financial = await getFinancialRisk(timeRange.start, timeRange.end);
      sources.push({ name: "Financial Risk Analytics", type: "analytics", period: timeRange.label });

      sections.push({
        title: "Financial Risk",
        metrics: [
          { label: "Potential Exposure", value: financial.potentialExposure, formatted: `৳${financial.potentialExposure.toLocaleString()}` },
          { label: "Exposure Rate", value: financial.exposurePercentage, formatted: `${financial.exposurePercentage}%` },
          { label: "Cancelled Value", value: financial.cancelledOrderValue, formatted: `৳${financial.cancelledOrderValue.toLocaleString()}` },
          { label: "Refunded Amount", value: financial.refundedAmount, formatted: `৳${financial.refundedAmount.toLocaleString()}` },
        ],
        data: financial,
      });
      break;
    }

    case CopilotIntent.ORDER_ANALYSIS: {
      const orders = await getOrderMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Order Analytics", type: "database", period: timeRange.label });

      sections.push({
        title: "Order Metrics",
        metrics: [
          { label: "Total Orders", value: orders.total, formatted: orders.total.toLocaleString() },
          { label: "Delivered", value: orders.delivered, formatted: orders.delivered.toLocaleString() },
          { label: "Cancelled", value: orders.cancelled, formatted: orders.cancelled.toLocaleString() },
          { label: "Returned", value: orders.returned, formatted: orders.returned.toLocaleString() },
        ],
        data: orders,
      });
      break;
    }

    case CopilotIntent.CUSTOMER_ANALYSIS: {
      const customers = await getCustomerMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Customer Analytics", type: "database", period: timeRange.label });

      sections.push({
        title: "Customer Metrics",
        metrics: [
          { label: "Total Customers", value: customers.total, formatted: customers.total.toLocaleString() },
          { label: "Active Customers", value: customers.activeUsers, formatted: customers.activeUsers.toLocaleString() },
          { label: "New Customers", value: customers.newUsers, formatted: customers.newUsers.toLocaleString() },
        ],
        data: customers,
      });
      break;
    }

    case CopilotIntent.PRODUCT_ANALYSIS:
    case CopilotIntent.INVENTORY_ANALYSIS: {
      const products = await getProductMetrics(timeRange.start, timeRange.end);
      sources.push({ name: "Product Analytics", type: "database", period: timeRange.label });

      sections.push({
        title: "Product Metrics",
        metrics: [
          { label: "Total Products", value: products.total, formatted: products.total.toLocaleString() },
          { label: "Low Stock", value: products.lowStock, formatted: products.lowStock.toLocaleString() },
          { label: "Out of Stock", value: products.outOfStock, formatted: products.outOfStock.toLocaleString() },
        ],
        data: products,
      });
      break;
    }

    default: {
      const overview = await getMarketplaceOverview();
      sources.push({ name: "Marketplace Database", type: "database" });
      sections.push({
        title: "Marketplace Overview",
        metrics: [
          { label: "Users", value: overview.totalUsers, formatted: overview.totalUsers.toLocaleString() },
          { label: "Sellers", value: overview.approvedSellers, formatted: overview.approvedSellers.toLocaleString() },
          { label: "Orders", value: overview.totalOrders, formatted: overview.totalOrders.toLocaleString() },
          { label: "Revenue", value: overview.totalRevenue, formatted: `৳${overview.totalRevenue.toLocaleString()}` },
        ],
        data: overview,
      });
      break;
    }
  }

  return { intent, timeRange, sections, sources };
}
