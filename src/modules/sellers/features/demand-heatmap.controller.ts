import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";

// 13. DEMAND HEATMAP
export const getDemandHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const { timeframe = "30d" } = req.query;

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const categories = ["Electronics", "Fashion", "Beauty & Care", "Home & Living", "Sports & Gear"];

  // Density intensity grid: 0 (Low) to 100 (Peak)
  const heatmapData = categories.map((cat) => {
    return {
      category: cat,
      days: days.map((day, dIdx) => {
        const isWeekend = day === "Fri" || day === "Sat";
        const baseIntensity = cat === "Electronics" ? 65 : cat === "Fashion" ? 75 : 55;
        const score = Math.min(100, Math.round(baseIntensity + (isWeekend ? 25 : (dIdx % 3) * 8)));
        return {
          day,
          intensity: score,
          level: score >= 85 ? "peak" : score >= 65 ? "high" : score >= 45 ? "medium" : "low",
          orderVolume: Math.round(score * 1.4),
        };
      }),
    };
  });

  sendSuccess(res, {
    timeframe,
    categories,
    days,
    heatmapData,
    peakDays: "Friday & Saturday (Weekend Evening Peaks)",
    topCategory: "Fashion & Lifestyle (88% peak saturation)",
  });
});
