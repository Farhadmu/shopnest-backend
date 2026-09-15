import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";

/** Resolves the authenticated seller's store. Returns null if the user does not have a store. */
export async function getSellerStore(userId: string) {
  return await Store.findOne({
    $or: [{ ownerId: userId }, { userId: userId }],
  });
}

/** Helper to fetch all seller-specific products and orders with extracted seller items */
export async function getSellerContext(userId: string) {
  const store = await getSellerStore(userId);
  if (!store) {
    return {
      store: null,
      products: [],
      sellerOrders: [],
      totalRevenue: 0,
      totalOrders: 0,
      deliveredOrders: 0,
      pendingOrders: 0,
      returnedOrders: 0,
      cancelledOrders: 0,
      uniqueBuyerIds: [],
    };
  }
  const storeIdStr = store._id?.toString() || store.id;

  const products = await Product.find({
    $or: [
      { sellerId: userId },
      { storeId: storeIdStr },
      { storeId: store.id },
    ],
    isDeleted: false,
  }).sort({ createdAt: -1 });

  const rawOrders = await Order.find({
    $or: [
      { "items.sellerId": userId },
      { "items.storeId": storeIdStr },
      { "items.storeId": store.id },
    ],
  }).sort({ createdAt: -1 });

  // Filter order items specifically for this seller
  const sellerOrders = rawOrders.map((order) => {
    const sellerItems = (order.items || []).filter(
      (item) =>
        item.sellerId === userId ||
        item.storeId === storeIdStr ||
        item.storeId === store.id
    );
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

