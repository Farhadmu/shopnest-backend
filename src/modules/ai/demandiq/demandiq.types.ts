export type StockoutRiskLevel = "critical" | "warning" | "healthy" | "overstocked";

export interface DemandForecastPoint {
  date: string;
  historical?: number;
  forecasted: number;
  lowerBound: number;
  upperBound: number;
}

export interface ProductDemandMetrics {
  productId: string;
  title: string;
  sku: string;
  category: string;
  currentStock: number;
  unitPrice: number;
  costPrice: number;
  totalSoldHistory: number;
  dailyVelocity7d: number;
  dailyVelocity30d: number;
  dailyVelocityTrend: "increasing" | "stable" | "declining";
  trendPercentage: number;
  daysOfSupply: number;
  stockoutDate: string | null;
  stockoutRisk: StockoutRiskLevel;
  projectedDemandNext14d: number;
  projectedDemandNext30d: number;
  projectedRevenue30d: number;
  revenueAtRisk: number;
  reorderPoint: number;
  recommendedReorderQty: number;
  safetyStock: number;
  leadTimeDays: number;
  serviceLevelPercent: number; // e.g. 98%
  forecastPoints: DemandForecastPoint[];
}

export interface DemandIQOverview {
  storeName: string;
  totalTrackedProducts: number;
  criticalStockoutsCount: number;
  warningStockoutsCount: number;
  healthyStockCount: number;
  overstockedCount: number;
  totalInventoryUnits: number;
  totalInventoryValue: number;
  totalRevenueAtRisk30d: number;
  averageDaysOfSupply: number;
  allProducts: ProductDemandMetrics[];
  topStockoutRisks: ProductDemandMetrics[];
  topRevenueGenerators: ProductDemandMetrics[];
  categoryBreakdown: Array<{
    category: string;
    productCount: number;
    velocity30d: number;
    stockoutRiskCount: number;
    inventoryValue: number;
  }>;
  macroFactors: {
    seasonalIndex: number;
    marketDemandPulse: "high" | "moderate" | "steady";
    supplyChainStressIndex: number; // 0 - 100
  };
}

export type ShockScenarioType = "port_delay" | "demand_surge" | "climate_shock" | "supplier_delay";

export interface ShockSimulationParams {
  scenarioType: ShockScenarioType;
  delayDays?: number;
  demandMultiplier?: number;
  affectedCategory?: string;
}

export interface ShockSimulationResult {
  scenario: {
    type: ShockScenarioType;
    label: string;
    description: string;
    delayDays: number;
    demandMultiplier: number;
  };
  baselineStockoutCount: number;
  shockedStockoutCount: number;
  newStockoutsTriggered: number;
  baselineRevenueAtRisk: number;
  shockedRevenueAtRisk: number;
  additionalLostRevenue: number;
  impactedProducts: Array<{
    productId: string;
    title: string;
    category: string;
    currentStock: number;
    normalStockoutDays: number;
    shockedStockoutDays: number;
    gapDays: number;
    severity: "critical" | "warning";
    estimatedLostUnits: number;
    estimatedRevenueLoss: number;
  }>;
  mitigationPlaybook: Array<{
    step: number;
    action: string;
    expectedSavings: string;
    urgency: "immediate" | "high" | "medium";
  }>;
}

export interface ProcurementCitation {
  sku: string;
  title: string;
  currentStock: number;
  dailyVelocity: number;
  daysRemaining: number;
  recommendedReorderQty: number;
  revenueAtRisk: number;
}

export interface ProcurementChatResponse {
  answer: string;
  summaryPills?: Array<{ label: string; value: string; color: "red" | "amber" | "emerald" | "indigo" }>;
  citations: ProcurementCitation[];
  suggestedActions: Array<{
    title: string;
    actionType: "generate_po" | "simulate_shock" | "adjust_safety_stock" | "view_forecast";
    payload?: Record<string, unknown>;
  }>;
}

export interface PurchaseOrderItem {
  productId: string;
  sku: string;
  title: string;
  category: string;
  currentStock: number;
  dailyVelocity: number;
  daysOfSupply: number;
  reorderPoint: number;
  suggestedReorderQty: number;
  estimatedUnitCost: number;
  lineTotal: number;
  urgency: "critical" | "high" | "medium";
}

export interface PurchaseOrderProposal {
  poNumber: string;
  createdAt: string;
  validUntil: string;
  storeName: string;
  targetServiceLevel: string; // e.g. "98.0%"
  leadTimeAssumptionDays: number;
  items: PurchaseOrderItem[];
  totalUnitsToOrder: number;
  totalEstimatedInvestment: number;
  totalProtectedRevenue: number;
  notes: string;
}
