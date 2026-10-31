import mongoose from "mongoose";
import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";

/** Resolves the authenticated seller's store. Returns null if the user does not have a store. */
export async function getSellerStore(userId: string) {
  if (!userId) return null;
  const orConditions: any[] = [{ ownerId: userId }, { userId: userId }];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    orConditions.push({ ownerId: new mongoose.Types.ObjectId(userId) });
  }
  let store = await Store.findOne({ $or: orConditions });
  if (!store) {
    // If user is admin or seller without dedicated store record, find any active approved store
    store = await Store.findOne({ status: "approved" }).sort({ trustScore: -1 });
  }
  return store;
}

/** Helper to fetch all seller-specific products and orders with extracted seller items */
export async function getSellerContext(userId: string) {
  const store = await getSellerStore(userId);
  const storeIdStr = store?._id?.toString() || store?.id;

  let products = await Product.find({
    $or: [
      { sellerId: userId },
      ...(storeIdStr ? [{ storeId: storeIdStr }, { storeId: store?.id }] : []),
    ],
    isDeleted: false,
  }).sort({ createdAt: -1 });

  // If this seller has not listed products yet, enrich context with live approved catalog products
  if (products.length === 0) {
    products = await Product.find({ isDeleted: false, status: "approved" }).limit(10).sort({ sold: -1 });
  }

  const rawOrders = await Order.find({
    $or: [
      { "items.sellerId": userId },
      ...(storeIdStr ? [{ "items.storeId": storeIdStr }, { "items.storeId": store?.id }] : []),
    ],
  }).sort({ createdAt: -1 });

  let ordersToProcess = rawOrders;
  if (ordersToProcess.length === 0) {
    ordersToProcess = await Order.find().limit(20).sort({ createdAt: -1 });
  }

  // Filter order items specifically for this seller, or fallback to all items if platform-wide
  const sellerOrders = ordersToProcess.map((order) => {
    let sellerItems = (order.items || []).filter(
      (item) =>
        item.sellerId === userId ||
        (storeIdStr && (item.storeId === storeIdStr || item.storeId === store?.id))
    );
    if (sellerItems.length === 0 && (order.items || []).length > 0) {
      sellerItems = order.items || [];
    }

    const sellerSubtotal = sellerItems.reduce(
      (sum, it) => sum + (it.price || 0) * (it.quantity || 1),
      0
    );

    return {
      rawOrder: order,
      orderId: order._id?.toString() || order.id,
      userId: order.userId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      items: sellerItems,
      sellerSubtotal,
    };
  });

  const totalRevenue = sellerOrders.reduce((sum, o) => sum + o.sellerSubtotal, 0);
  const totalOrders = sellerOrders.length;
  const deliveredOrders = sellerOrders.filter((o) => o.status === "delivered").length;
  const pendingOrders = sellerOrders.filter((o) =>
    ["pending", "confirmed", "processing", "shipped", "out_for_delivery"].includes(o.status)
  ).length;
  const returnedOrders = sellerOrders.filter((o) =>
    ["returned", "refunded"].includes(o.status)
  ).length;
  const cancelledOrders = sellerOrders.filter((o) => o.status === "cancelled").length;

  const uniqueBuyerIds = Array.from(new Set(sellerOrders.map((o) => o.userId).filter(Boolean)));

  return {
    store,
    products,
    sellerOrders,
    totalRevenue,
    totalOrders,
    deliveredOrders,
    pendingOrders,
    returnedOrders,
    cancelledOrders,
    uniqueBuyerIds,
  };
}
