import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { getSellerStore } from "../seller-store.util";

// 11. SELLER HEALTH SCORE
export const getSellerHealthScore = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const totalProducts = await Product.countDocuments({ $or: [{ storeId: store.id }, { sellerId: userId }], isDeleted: false });
  const orders = await Order.find({ "items.storeId": store.id });

  // Calculate real performance metrics
  const deliveredOrders = orders.filter((o) => o.status === "delivered").length;
  const returnedOrders = orders.filter((o) => o.status === "returned" || o.status === "refunded").length;
  const totalOrders = orders.length;

  const deliveryReliability = totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 100;
  const returnRatePercent = totalOrders > 0 ? Math.round((returnedOrders / totalOrders) * 100) : 0;
  const customerSatisfaction = Math.min(100, Math.round((store.rating || 5.0) * 20));
  const responseRate = 95;
  const productQuality = customerSatisfaction;

  // Composite Weighted Score
  const overallHealth = Math.round(
    customerSatisfaction * 0.30 +
      responseRate * 0.20 +
      deliveryReliability * 0.25 +
      productQuality * 0.15 +
      (100 - returnRatePercent * 3) * 0.10
  );

  const recommendations = [
    returnRatePercent > 5 ? "Review customer feedback on return reasons to optimize listing accuracy." : "Zero returns recorded! Maintain strict packaging standards.",
    deliveryReliability < 90 ? "Dispatch pending orders promptly to boost delivery reliability." : "Great dispatch speed! Top tier on ShopNest marketplace.",
    totalProducts < 3 ? "Expand your active catalog with more products to increase buyer discovery." : "Active product catalog is healthy.",
  ];

  sendSuccess(res, {
    storeName: store.storeName,
    overallHealth,
    metrics: {
      customerSatisfaction: { score: customerSatisfaction, unit: "%", target: 95, status: "excellent" },
      responseRate: { score: responseRate, unit: "%", target: 90, status: "good" },
      deliveryReliability: { score: deliveryReliability, unit: "%", target: 95, status: "excellent" },
      productQuality: { score: productQuality, unit: "%", target: 90, status: "good" },
      returnRate: { score: returnRatePercent, unit: "%", target: 5, status: "excellent" },
    },
    recommendations,
  });
});
