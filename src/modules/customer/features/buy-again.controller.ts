import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { BuyAgainItem } from "../customer-features.model";

export const getBuyAgainProducts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let buyAgainItems = await BuyAgainItem.find({ userId }).sort({ lastPurchasedAt: -1 }).limit(20);

  if (buyAgainItems.length === 0) {
    const orders = await Order.find({ userId, status: "delivered" }).sort({ createdAt: -1 }).limit(10);
    const productMap: Record<string, { count: number; lastOrder: Date; orderId: string; price: number; title: string; category: string }> = {};
    orders.forEach((order) => {
      order.items.forEach((item: { productId: string; title: string; quantity: number; price: number; category?: string }) => {
        if (!productMap[item.productId]) productMap[item.productId] = { count: 0, lastOrder: order.createdAt, orderId: order.id, price: item.price, title: item.title, category: item.category || "General" };
        productMap[item.productId].count += item.quantity;
        if (new Date(order.createdAt) > new Date(productMap[item.productId].lastOrder)) { productMap[item.productId].lastOrder = order.createdAt; productMap[item.productId].orderId = order.id; }
      });
    });

    for (const [productId, data] of Object.entries(productMap)) {
      const item = await BuyAgainItem.findOneAndUpdate(
        { userId, productId },
        { $set: { productTitle: data.title, category: data.category, lastPurchasedAt: data.lastOrder, lastOrderId: data.orderId, lastPrice: data.price }, $inc: { purchaseCount: data.count } },
        { upsert: true, new: true }
      );
      buyAgainItems.push(item);
    }
  }

  const productIds = buyAgainItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const items = buyAgainItems.map((item) => {
    const product = productMap.get(item.productId);
    return {
      productId: item.productId, title: item.productTitle, category: item.category,
      lastPrice: item.lastPrice, currentPrice: product ? (product.discountPrice || product.price) : item.lastPrice,
      purchaseCount: item.purchaseCount, daysSincePurchase: Math.floor((Date.now() - new Date(item.lastPurchasedAt).getTime()) / (1000 * 60 * 60 * 24)),
      inStock: product ? product.stock > 0 : false, image: product?.images?.[0] || "", available: !!product,
    };
  });

  sendSuccess(res, { items });
});

// ============================================================
// DIGITAL PURCHASE VAULT (Feature 22)
// ============================================================
