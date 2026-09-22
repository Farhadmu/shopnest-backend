import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { Cart } from "../../cart/cart.model";
import { Wishlist } from "../../wishlist/wishlist.model";
import { Store } from "../../sellers/store.model";
import { DeliveryRequest } from "../../delivery/delivery-request.model";
import { DeliveryManDetails } from "../../delivery/delivery-man.model";
import { ReturnRequest } from "../../customer/customer-features.model";
import { AnomalyLog, SystemTelemetry } from "../../admin/admin-intelligence.model";
import { AIContext, AIToolResult, AIEvidence } from "./ai-types";
import { AiEvidenceService } from "./ai-evidence.service";
import { AiPermissionService } from "./ai-permission.service";

export class AiToolService {
  /**
   * 1. Search catalog products (Universal / Advisor / Guest / Customer)
   */
  public static async searchCatalogProducts(
    context: AIContext,
    params: {
      query?: string;
      category?: string;
      budgetMax?: number;
      budgetMin?: number;
      limit?: number;
    }
  ): Promise<AIToolResult<any[]>> {
    const evidence: AIEvidence[] = [];
    const limit = Math.min(params.limit || 6, 12);
    const filter: any = { isDeleted: { $ne: true } };

    if (params.category) {
      filter.$or = [
        { category: new RegExp(params.category, "i") },
        { tags: new RegExp(params.category, "i") },
      ];
    }

    if (params.budgetMax || params.budgetMin) {
      filter.price = {};
      if (params.budgetMax) filter.price.$lte = params.budgetMax;
      if (params.budgetMin) filter.price.$gte = params.budgetMin;
    }

    if (params.query) {
      const qRegex = new RegExp(params.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (!filter.$or) {
        filter.$or = [
          { title: qRegex },
          { description: qRegex },
          { tags: qRegex },
          { brand: qRegex },
        ];
      }
    }

    const products = await Product.find(filter)
      .sort({ ratingAvg: -1, salesCount: -1 })
      .limit(limit)
      .lean();

    for (const p of products) {
      evidence.push(
        AiEvidenceService.fromSearch(
          "ProductCatalog",
          `${p.title} priced at ৳${p.price}`,
          `Stock: ${p.stock ?? "available"}, Rating: ${p.ratingAvg || 4.5}`,
          String(p._id)
        )
      );
    }

    return {
      toolName: "searchCatalogProducts",
      success: true,
      data: products.map((p) => ({
        id: String(p._id),
        title: p.title,
        price: p.price,
        image: p.images?.[0] || "",
        rating: p.ratingAvg || 4.5,
        category: p.category,
        stock: p.stock,
        description: p.description?.slice(0, 140),
      })),
      evidence,
      summary: `Found ${products.length} matching catalog products.`,
    };
  }

  /**
   * 2. Customer: Get Own Orders (Anti-IDOR)
   */
  public static async getCustomerOrders(
    context: AIContext,
    params?: { status?: string; limit?: number }
  ): Promise<AIToolResult<any[]>> {
    if (!context.userId) {
      return {
        toolName: "getCustomerOrders",
        success: false,
        data: [],
        evidence: [],
        error: "User is not authenticated.",
      };
    }

    const evidence: AIEvidence[] = [];
    const filter: any = { userId: context.userId };
    if (params?.status) {
      filter.status = params.status;
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(params?.limit || 5)
      .lean();

    for (const ord of orders) {
      evidence.push(
        AiEvidenceService.fromDatabase(
          "CustomerOrder",
          `Order #${String(ord._id).slice(-6)} Status: ${ord.status}`,
          `৳${ord.totalAmount} (${ord.items?.length || 0} items)`,
          String(ord._id)
        )
      );
    }

    return {
      toolName: "getCustomerOrders",
      success: true,
      data: orders.map((o) => ({
        id: String(o._id),
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        itemsCount: o.items?.length || 0,
        shippingAddress: o.shippingAddress,
        items: o.items?.map((item: any) => ({
          name: item.name || item.title,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
        })),
      })),
      evidence,
      summary: `Retrieved ${orders.length} verified orders from your account.`,
    };
  }

  /**
   * 3. Customer: Get Own Cart
   */
  public static async getCustomerCart(context: AIContext): Promise<AIToolResult<any>> {
    if (!context.userId) {
      return { toolName: "getCustomerCart", success: false, data: null, evidence: [], error: "Not authenticated" };
    }

    const cart = await Cart.findOne({ userId: context.userId }).populate("items.productId").lean();
    const evidence: AIEvidence[] = [];

    const total = (cart?.items || []).reduce((acc: number, item: any) => {
      const price = item.productId?.price || item.price || 0;
      return acc + price * (item.quantity || 1);
    }, 0);

    evidence.push(
      AiEvidenceService.fromDatabase(
        "CustomerCart",
        `Cart item count: ${cart?.items?.length || 0}`,
        `Total: ৳${total}`,
        cart ? String(cart._id) : undefined
      )
    );

    return {
      toolName: "getCustomerCart",
      success: true,
      data: {
        itemCount: cart?.items?.length || 0,
        subtotal: total,
        items: (cart?.items || []).map((item: any) => ({
          productId: String(item.productId?._id || item.productId),
          title: item.productId?.title || "Cart Item",
          price: item.productId?.price || item.price || 0,
          quantity: item.quantity || 1,
        })),
      },
      evidence,
    };
  }

  /**
   * 4. Customer: Get Own Wishlist
   */
  public static async getCustomerWishlist(context: AIContext): Promise<AIToolResult<any>> {
    if (!context.userId) {
      return { toolName: "getCustomerWishlist", success: false, data: [], evidence: [], error: "Not authenticated" };
    }

    const wishlist = await Wishlist.findOne({ userId: context.userId }).lean();
    const evidence: AIEvidence[] = [];
    const itemIds = (wishlist?.items || []).map((it) => it.productId);
    const products = itemIds.length > 0 ? await Product.find({ _id: { $in: itemIds } }).lean() : [];

    evidence.push(
      AiEvidenceService.fromDatabase(
        "CustomerWishlist",
        `Wishlist product count`,
        products.length,
        wishlist ? String(wishlist._id) : undefined
      )
    );

    return {
      toolName: "getCustomerWishlist",
      success: true,
      data: products.map((p) => ({
        id: String(p._id),
        title: p.title,
        price: p.price,
        stock: p.stock,
        image: p.images?.[0] || "",
      })),
      evidence,
      summary: `Found ${products.length} saved wishlist items.`,
    };
  }

  /**
   * 5. Customer: Get Own Returns & Refunds
   */
  public static async getCustomerReturns(context: AIContext): Promise<AIToolResult<any[]>> {
    if (!context.userId) {
      return { toolName: "getCustomerReturns", success: false, data: [], evidence: [], error: "Not authenticated" };
    }

    const returns = await ReturnRequest.find({ userId: context.userId }).sort({ createdAt: -1 }).limit(5).lean();
    const evidence: AIEvidence[] = [];

    for (const ret of returns) {
      evidence.push(
        AiEvidenceService.fromDatabase(
          "CustomerReturn",
          `Return #${String(ret._id).slice(-6)} Status: ${ret.status}`,
          `Reason: ${ret.reason || "Return"}`,
          String(ret._id)
        )
      );
    }

    return {
      toolName: "getCustomerReturns",
      success: true,
      data: returns.map((r: any) => ({
        id: String(r._id),
        orderId: r.orderId,
        productId: r.productId,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
      })),
      evidence,
    };
  }

  /**
   * 6. Seller: Get Store Sales & Analytics (Anti-IDOR)
   */
  public static async getSellerSales(
    context: AIContext,
    _params?: { days?: number }
  ): Promise<AIToolResult<any>> {
    const storeId = await AiPermissionService.assertSellerOwnsStore(context.userId!, context.sellerId);
    const evidence: AIEvidence[] = [];

    const orders = await Order.find({
      "items.storeId": storeId,
      status: { $ne: "cancelled" },
    }).lean();

    let totalRevenue = 0;
    let completedOrders = 0;
    let pendingOrders = 0;

    for (const ord of orders) {
      const storeItems = (ord.items || []).filter((it: any) => String(it.storeId) === storeId);
      const sub = storeItems.reduce((acc: number, it: any) => acc + (it.price || 0) * (it.quantity || 1), 0);
      totalRevenue += sub;

      if (ord.status === "delivered") completedOrders++;
      if (["pending", "processing", "paid"].includes(ord.status)) pendingOrders++;
    }

    evidence.push(
      AiEvidenceService.fromDatabase("SellerStore", "Total Gross Merchandise Value (GMV)", `৳${totalRevenue}`, storeId),
      AiEvidenceService.fromDatabase("SellerStore", "Completed Orders Count", completedOrders, storeId),
      AiEvidenceService.fromDatabase("SellerStore", "Active Pending Orders", pendingOrders, storeId)
    );

    return {
      toolName: "getSellerSales",
      success: true,
      data: {
        storeId,
        totalRevenue,
        orderCount: orders.length,
        completedOrders,
        pendingOrders,
      },
      evidence,
      summary: `Your store has generated ৳${totalRevenue.toLocaleString()} across ${orders.length} orders.`,
    };
  }

  /**
   * 7. Seller: Get Inventory & Low Stock Alerts
   */
  public static async getSellerInventory(context: AIContext): Promise<AIToolResult<any>> {
    const storeId = await AiPermissionService.assertSellerOwnsStore(context.userId!, context.sellerId);
    const evidence: AIEvidence[] = [];

    const products = await Product.find({ storeId, isDeleted: { $ne: true } }).lean();
    const lowStock = products.filter((p) => (p.stock || 0) <= 5);
    const outOfStock = products.filter((p) => (p.stock || 0) === 0);

    evidence.push(
      AiEvidenceService.fromDatabase("SellerInventory", "Total Registered Products", products.length, storeId),
      AiEvidenceService.fromDatabase("SellerInventory", "Low Stock Products (< 5 units)", lowStock.length, storeId),
      AiEvidenceService.fromDatabase("SellerInventory", "Out of Stock Products", outOfStock.length, storeId)
    );

    return {
      toolName: "getSellerInventory",
      success: true,
      data: {
        totalProducts: products.length,
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        lowStockItems: lowStock.map((p) => ({ id: String(p._id), title: p.title, stock: p.stock, price: p.price })),
      },
      evidence,
      summary: `You have ${products.length} products listed. ${lowStock.length} items have low stock warning.`,
    };
  }

  /**
   * 8. Admin: Get Marketplace Intelligence & Platform Overview
   */
  public static async getMarketplaceMetrics(context: AIContext): Promise<AIToolResult<any>> {
    if (context.role !== "admin") {
      return { toolName: "getMarketplaceMetrics", success: false, data: null, evidence: [], error: "Unauthorized" };
    }

    const evidence: AIEvidence[] = [];
    const [orderCount, activeRiders, approvedStores, totalStores, pendingStores, anomaliesCount] = await Promise.all([
      Order.countDocuments({}),
      DeliveryManDetails.countDocuments({ isOnline: true }).catch(() => 0),
      Store.countDocuments({ status: "approved" }),
      Store.countDocuments({}),
      Store.countDocuments({ status: "pending" }),
      AnomalyLog.countDocuments({ status: { $ne: "resolved" } }),
    ]);

    const completed = await Order.find({ status: "delivered" }).select("totalAmount").lean();
    const gmv = completed.reduce((acc, o) => acc + (o.totalAmount || 0), 0);

    evidence.push(
      AiEvidenceService.fromDatabase("PlatformCommand", "Total Marketplace GMV", `৳${gmv}`),
      AiEvidenceService.fromDatabase("PlatformCommand", "Total Orders", orderCount),
      AiEvidenceService.fromDatabase("PlatformCommand", "Active Online Riders", activeRiders),
      AiEvidenceService.fromDatabase("PlatformCommand", "Approved Active Stores", approvedStores),
      AiEvidenceService.fromDatabase("PlatformCommand", "Total Registered Stores", totalStores),
      AiEvidenceService.fromDatabase("PlatformCommand", "Pending Store Approvals", pendingStores),
      AiEvidenceService.fromDatabase("PlatformCommand", "Unresolved Anomalies", anomaliesCount)
    );

    return {
      toolName: "getMarketplaceMetrics",
      success: true,
      data: {
        totalGmv: gmv,
        orderCount,
        activeRiders,
        activeStores: approvedStores,
        totalStores,
        pendingStores,
        unresolvedAnomalies: anomaliesCount,
      },
      evidence,
      summary: `ShopNest platform GMV stands at ৳${gmv.toLocaleString()} with ${approvedStores} approved active stores (${totalStores} total stores, ${pendingStores} pending).`,
    };
  }

  /**
   * 9. Delivery Man: Get Active Deliveries & Multi-Order Routing (Anti-IDOR)
   */
  public static async getActiveDeliveries(context: AIContext): Promise<AIToolResult<any>> {
    const courierId = context.deliveryManId || context.userId;
    if (!courierId) {
      return { toolName: "getActiveDeliveries", success: false, data: null, evidence: [], error: "Unauthorized" };
    }

    const evidence: AIEvidence[] = [];
    const missions = await DeliveryRequest.find({
      assignedDeliveryManId: courierId,
      status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
    }).lean();

    evidence.push(
      AiEvidenceService.fromDatabase(
        "CourierDispatch",
        "Active Deliveries in Progress",
        missions.length,
        courierId
      )
    );

    for (const m of missions) {
      const storeName = m.pickupAddress || "Merchant Store";
      const customerAddr = m.deliveryAddress || "Customer Destination";
      evidence.push(
        AiEvidenceService.fromDatabase(
          "DeliveryMission",
          `Mission #${String(m._id).slice(-4)} (${m.status})`,
          `Pickup: ${storeName} -> Dropoff: ${customerAddr}`,
          String(m._id)
        )
      );
    }

    return {
      toolName: "getActiveDeliveries",
      success: true,
      data: missions.map((m: any) => ({
        id: String(m._id),
        orderId: m.orderId,
        status: m.status,
        pickupAddress: m.pickupAddress || "Merchant Store",
        deliveryAddress: m.deliveryAddress || "Customer Address",
        estimatedDistance: m.estimatedDistance || 3.2,
      })),
      evidence,
      summary: `You have ${missions.length} active delivery missions assigned to you.`,
    };
  }
}

// Optimization: Default lean projection fields for catalog search
export const PRODUCT_RECOMMENDATION_FIELDS = ["title", "price", "category", "rating", "storeId"];

// Target fulfillment SLA threshold (hours)
export const TARGET_FULFILLMENT_SLA_HOURS = 24;

// Maximum retry attempts for customer phone unreachable status
export const MAX_CUSTOMER_CONTACT_ATTEMPTS = 3;
