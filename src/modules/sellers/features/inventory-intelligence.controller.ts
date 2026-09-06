import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { getSellerStore } from "../seller-store.util";

// 22. SMART INVENTORY INTELLIGENCE
export const getInventoryIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const products = await Product.find({ $or: [{ storeId: store.id }, { sellerId: userId }], isDeleted: false });

  const inventoryItems = products.map((p: any, idx: number) => {
    const stock = typeof p.stock === "number" ? p.stock : 0;
    const isOut = stock === 0;
    const isLow = stock > 0 && stock <= 10;
    const isOver = stock > 100;

    const demandTrend = stock > 20 ? "High" : "Medium";
    const stockOutRisk = isOut ? "Critical" as const : isLow ? "High" as const : isOver ? "Low" as const : "Medium" as const;
    const restockPriority = isOut ? "Immediate Action Required" : isLow ? "Restock within 48h" : isOver ? "Promote to clear excess" : "Healthy Stock";
    const velocity = isOver ? "Slow-moving" : stock < 20 ? "Fast-moving" : "Normal";

    return {
      id: p.id || p._id || `inv-${idx}`,
      title: p.title,
      currentStock: stock,
      price: p.discountPrice || p.price || 0,
      category: p.category || "General",
      demandTrend,
      stockOutRisk,
      restockPriority,
      velocity,
      estimatedDaysRemaining: isOut ? 0 : Math.max(2, Math.round(stock / 2)),
    };
  });

  const lowStockCount = inventoryItems.filter((i) => i.currentStock <= 10 && i.currentStock > 0).length;
  const outOfStockCount = inventoryItems.filter((i) => i.currentStock === 0).length;
  const overstockCount = inventoryItems.filter((i) => i.currentStock > 100).length;
  const totalItems = inventoryItems.length;

  const inventoryHealthScore = totalItems > 0
    ? Math.max(20, Math.min(100, 100 - (lowStockCount * 8 + outOfStockCount * 25 + overstockCount * 4)))
    : 100;

  sendSuccess(res, {
    inventoryHealthScore,
    summary: {
      totalItems,
      healthyStockCount: totalItems - (lowStockCount + outOfStockCount + overstockCount),
      lowStockCount,
      outOfStockCount,
      overstockCount,
    },
    items: inventoryItems,
    alerts: [
      outOfStockCount > 0 ? `${outOfStockCount} product(s) are out of stock.` : "Zero stockouts currently recorded.",
      lowStockCount > 0 ? `${lowStockCount} item(s) have low stock (<= 10 units).` : "All active products have adequate reserves.",
    ],
  });
});
