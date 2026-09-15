import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_BY_INDEX: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

const emptyHeatmap = (timeframe: unknown) => ({
  timeframe,
  categories: [] as string[],
  days: DAYS,
  heatmapData: [] as Array<{ category: string; days: unknown[] }>,
  peakDays: "",
  topCategory: "",
  isBasedOnRealStoreData: false,
});

// 13. DEMAND HEATMAP — derived exclusively from the authenticated seller's own catalog & orders.
export const getDemandHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { timeframe = "30d" } = req.query;
  const { products: sellerProducts, sellerOrders } = await getSellerContext(userId);

  // No orders yet -> explicit empty chart state (no marketplace / global data).
  if (sellerOrders.length === 0) {
    return sendSuccess(res, emptyHeatmap(timeframe));
  }

  const categories = Array.from(
    new Set(sellerProducts.map((p: any) => p.category).filter(Boolean))
  ).slice(0, 6);

  const productCategory = new Map<string, string>();
  sellerProducts.forEach((p: any) => {
    const id = p._id?.toString() || p.id;
    if (id) productCategory.set(String(id), p.category || "General");
  });

  const emptyDayMap = (): Record<string, number> =>
    DAYS.reduce((acc, d) => ({ ...acc, [d]: 0 }), {} as Record<string, number>);

  const categoryDayCounts: Record<string, Record<string, number>> = {};
  categories.forEach((cat) => {
    categoryDayCounts[cat] = emptyDayMap();
  });

  sellerOrders.forEach((order: any) => {
    const day = DAY_BY_INDEX[new Date(order.createdAt).getDay()] || "Mon";
    (order.items || []).forEach((item: any) => {
      const cat = productCategory.get(String(item.productId));
      if (cat && categoryDayCounts[cat]) {
        categoryDayCounts[cat][day] += item.quantity || 1;
      }
    });
  });

  const totalMatchedUnits = categories.reduce(
    (sum, cat) => sum + DAYS.reduce((s, day) => s + categoryDayCounts[cat][day], 0),
    0
  );

  // Orders exist but none belong to a catalog category we can map -> empty state.
  if (totalMatchedUnits === 0) {
    return sendSuccess(res, emptyHeatmap(timeframe));
  }

  const maxCellCount = Math.max(
    1,
    ...categories.flatMap((cat) => DAYS.map((day) => categoryDayCounts[cat][day]))
  );

  let topCategoryName = "";
  let topPeakIntensity = 0;
  const maxDaySum: Record<string, number> = emptyDayMap();

  const heatmapData = categories.map((cat) => {
    const days = DAYS.map((day) => {
      const count = categoryDayCounts[cat][day];
      const intensity = Math.min(99, Math.round((count / maxCellCount) * 100));
      maxDaySum[day] += intensity;
      return {
        day,
        intensity,
        level: intensity >= 85 ? "peak" : intensity >= 65 ? "high" : intensity >= 45 ? "medium" : "low",
        orderVolume: count,
      };
    });

    const peakIntensity = Math.max(...days.map((c) => c.intensity));
    if (peakIntensity > topPeakIntensity) {
      topPeakIntensity = peakIntensity;
      topCategoryName = cat;
    }

    return { category: cat, days };
  });

  const sortedPeakDays = Object.entries(maxDaySum).sort((a, b) => b[1] - a[1]);
  const primaryPeakDay = sortedPeakDays[0]?.[0] || "";
  const secondaryPeakDay = sortedPeakDays[1]?.[0] || "";

  sendSuccess(res, {
    timeframe,
    categories,
    days: DAYS,
    heatmapData,
    peakDays: primaryPeakDay ? `${primaryPeakDay} & ${secondaryPeakDay}` : "",
    topCategory: topCategoryName ? `${topCategoryName} (${topPeakIntensity}% peak intensity)` : "",
    isBasedOnRealStoreData: true,
  });
});
