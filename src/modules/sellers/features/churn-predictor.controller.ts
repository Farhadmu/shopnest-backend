import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 17. SELLER CHURN PREDICTOR
export const getChurnPredictor = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { sellerOrders, uniqueBuyerIds } = await getSellerContext(userId);

  const total = uniqueBuyerIds.length;
  const now = Date.now();

  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;

  if (total > 0) {
    const lastSeenMap: Record<string, number> = {};
    sellerOrders.forEach((o) => {
      const bId = o.userId;
      if (!bId) return;
      const orderTime = new Date(o.createdAt).getTime();
      if (!lastSeenMap[bId] || orderTime > lastSeenMap[bId]) {
        lastSeenMap[bId] = orderTime;
      }
    });

    Object.values(lastSeenMap).forEach((lastTime) => {
      const days = (now - lastTime) / (24 * 3600 * 1000);
      if (days > 90) {
        highCount += 1;
      } else if (days > 45) {
        medCount += 1;
      } else {
        lowCount += 1;
      }
    });
  }

  const highPct = total > 0 ? Math.round((highCount / total) * 100) : 0;
  const medPct = total > 0 ? Math.round((medCount / total) * 100) : 0;
  const lowPct = total > 0 ? Math.round((lowCount / total) * 100) : 0;

  sendSuccess(res, {
    riskTiers: {
      highRisk: {
        percentage: highPct,
        count: highCount,
        description: highCount > 0 ? `${highCount} buyer(s) inactive >90 days.` : "No critical churn cases.",
      },
      mediumRisk: {
        percentage: medPct,
        count: medCount,
        description: medCount > 0 ? `${medCount} buyer(s) inactive 45-90 days.` : "Moderate retention risk is low.",
      },
      lowRisk: {
        percentage: lowPct,
        count: lowCount,
        description: lowCount > 0 ? `${lowCount} active customer(s) purchased recently.` : "Awaiting first active store customers.",
      },
    },
    retentionTriggers: [
      {
        trigger: "Personalized 10% Loyalty Voucher",
        targetCount: highCount + medCount > 0 ? highCount + medCount : Math.max(1, total),
        projectedWinBack: "28% projected recovery",
      },
      {
        trigger: "New Catalog Arrivals Notification",
        targetCount: total > 0 ? total : 0,
        projectedWinBack: "35% open rate",
      },
    ],
  });
});

