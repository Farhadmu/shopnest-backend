import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Store } from "../../sellers/store.model";
import { Order } from "../../orders/order.model";

export const getMarketplaceMap = asyncHandler(async (req: Request, res: Response) => {
  const { metric = "orders" } = req.query;
  const orders = await Order.find({});
  const stores = await Store.find({ status: "approved" });

  const divisionNames = [
    { id: "dhaka", name: "Dhaka Division", match: "dhaka" },
    { id: "chittagong", name: "Chittagong Division", match: "chittagong" },
    { id: "sylhet", name: "Sylhet Division", match: "sylhet" },
    { id: "rajshahi", name: "Rajshahi Division", match: "rajshahi" },
    { id: "khulna", name: "Khulna Division", match: "khulna" },
    { id: "barisal", name: "Barisal Division", match: "barisal" },
    { id: "rangpur", name: "Rangpur Division", match: "rangpur" },
    { id: "mymensingh", name: "Mymensingh Division", match: "mymensingh" },
  ];

  const divisions = divisionNames.map((d) => {
    const matchedOrders = orders.filter((o) =>
      String(o.shippingAddress || "").toLowerCase().includes(d.match)
    );
    const divRevenue = matchedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const divCustomers = new Set(matchedOrders.map((o) => o.userId)).size;

    return {
      id: d.id,
      name: d.name,
      orders: matchedOrders.length,
      revenue: divRevenue,
      sellers: d.id === "dhaka" ? stores.length : 0,
      customers: divCustomers,
      growth: matchedOrders.length > 0 ? "+100%" : "0%",
    };
  });

  sendSuccess(res, {
    selectedMetric: metric,
    divisions,
    nationalHub: "Dhaka Central Logistics Hub",
    fastestGrowingRegion: "Dhaka Mega Hub",
  });
});

// 29. ANOMALY DETECTION CENTER