import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { ProductLifecycle } from "../customer-intelligence.model";
import { Order } from "../../orders/order.model";
import { Product } from "../../products/product.model";
import { getUserId } from "../../../utils/getUserId";

function calculateWarrantyStatus(expiryDate?: Date): { status: string; remainingDays?: number } {
  if (!expiryDate) return { status: "not_available" };
  const now = new Date();
  const diffMs = new Date(expiryDate).getTime() - now.getTime();
  const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (remainingDays < 0) return { status: "expired", remainingDays: 0 };
  if (remainingDays <= 30) return { status: "expiring_soon", remainingDays };
  return { status: "active", remainingDays };
}

function calculateMaintenanceStatus(dueDate?: Date): string {
  if (!dueDate) return "no_schedule";
  const now = new Date();
  const diffMs = new Date(dueDate).getTime() - now.getTime();
  const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (remainingDays < 0) return "overdue";
  if (remainingDays <= 7) return "due_soon";
  return "up_to_date";
}

// PRODUCT LIFECYCLE
export const getProductLifecycle = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const lifecycles = await ProductLifecycle.find({ userId }).sort({ createdAt: -1 }).lean();

  if (lifecycles.length === 0) {
    const deliveredOrders = await Order.find({ userId, status: { $in: ["delivered", "completed", "shipped", "out_for_delivery"] } }).sort({ createdAt: -1 }).lean() as any[];
    const productIds = [...new Set(deliveredOrders.flatMap((o) => o.items.map((i: any) => i.productId)))];
    const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).lean();
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    for (const order of deliveredOrders) {
      const orderId = String(order._id);
      for (const item of order.items) {
        const existing = await ProductLifecycle.findOne({ userId, orderId, productId: item.productId });
        if (existing) continue;

        const product = productMap.get(item.productId);
        let warrantyExpiryDate: Date | undefined;
        let warrantyProvider: string | undefined;
        let warrantyDurationMonths: number | undefined;
        let warrantyStartDate: Date | undefined;

        if (product?.warrantyMonths && product.warrantyMonths > 0) {
          warrantyDurationMonths = product.warrantyMonths;
          warrantyStartDate = new Date(order.createdAt);
          warrantyExpiryDate = new Date(warrantyStartDate);
          if (warrantyDurationMonths) {
            warrantyExpiryDate.setMonth(warrantyExpiryDate.getMonth() + warrantyDurationMonths);
          }
          warrantyProvider = product.warrantyProvider || "Seller";
        }

        const created = await ProductLifecycle.create({
          userId,
          orderId,
          productId: item.productId,
          productTitle: item.title,
          category: product?.category || "General",
          purchaseDate: order.createdAt,
          estimatedLifespanMonths: 36,
          usagePercentage: 5,
          warrantyProvider,
          warrantyDurationMonths,
          warrantyStartDate,
          warrantyExpiryDate,
          maintenanceReminders: [],
          status: "active",
        });
        lifecycles.push(created.toJSON() as any);
      }
    }
  }

  const enriched = lifecycles.map((lc: any) => {
    const warranty = calculateWarrantyStatus(lc.warrantyExpiryDate);
    const maintenanceStatus = lc.maintenanceReminders?.length
      ? calculateMaintenanceStatus(lc.maintenanceReminders[0].dueDate)
      : "no_schedule";

    return {
      ...lc,
      id: String(lc._id || lc.id),
      warrantyStatus: warranty.status,
      warrantyRemainingDays: warranty.remainingDays,
      maintenanceStatus,
    };
  });

  sendSuccess(res, { items: enriched, total: enriched.length });
});

export const getLifecycleDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const lc = await ProductLifecycle.findOne({ _id: id, userId }).lean();
  if (!lc) throw ApiError.notFound("Lifecycle record not found");

  const warranty = calculateWarrantyStatus(lc.warrantyExpiryDate);
  const maintenanceStatus = lc.maintenanceReminders?.length
    ? calculateMaintenanceStatus(lc.maintenanceReminders[0].dueDate)
    : "no_schedule";

  sendSuccess(res, {
    ...lc,
    id: String(lc._id),
    warrantyStatus: warranty.status,
    warrantyRemainingDays: warranty.remainingDays,
    maintenanceStatus,
  });
});

export const createLifecycleFromOrder = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { orderId } = req.params;

  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");

  const eligibleStatuses = ["delivered", "completed", "shipped", "out_for_delivery"];
  if (!eligibleStatuses.includes(order.status)) {
    throw ApiError.badRequest("Only delivered/completed orders can create lifecycle records");
  }

  const created: any[] = [];
  for (const item of order.items) {
    const product = await Product.findOne({ _id: item.productId, isDeleted: false });
    const category = product?.category || "General";

    let warrantyExpiryDate: Date | undefined;
    let warrantyProvider: string | undefined;
    let warrantyDurationMonths: number | undefined;
    let warrantyStartDate: Date | undefined;

    if (product?.warrantyMonths && product.warrantyMonths > 0) {
      warrantyDurationMonths = product.warrantyMonths;
      warrantyStartDate = new Date(order.createdAt);
      warrantyExpiryDate = new Date(warrantyStartDate);
      if (warrantyDurationMonths) {
        warrantyExpiryDate.setMonth(warrantyExpiryDate.getMonth() + warrantyDurationMonths);
      }
      warrantyProvider = product.warrantyProvider || "Seller";
    }

    const existing = await ProductLifecycle.findOne({ userId, orderId, productId: item.productId });
    if (existing) continue;

    const lifecycle = await ProductLifecycle.create({
      userId,
      orderId: order.id,
      productId: item.productId,
      productTitle: item.title,
      category,
      purchaseDate: order.createdAt,
      estimatedLifespanMonths: 36,
      usagePercentage: 5,
      warrantyProvider,
      warrantyDurationMonths,
      warrantyStartDate,
      warrantyExpiryDate,
      maintenanceReminders: [],
      status: "active",
    });

    created.push(lifecycle.toJSON());
  }

  sendSuccess(res, created, "Lifecycle records created", 201);
});

export const addMaintenanceRecord = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;
  const { title, dueDate, notes, status } = req.body;

  if (!title || !dueDate) {
    throw ApiError.badRequest("Maintenance title and due date are required");
  }

  const lc = await ProductLifecycle.findOne({ _id: id, userId });
  if (!lc) throw ApiError.notFound("Lifecycle record not found");

  lc.maintenanceReminders.push({
    title: String(title),
    dueDate: new Date(dueDate),
    status: status || "pending",
    notes: notes || undefined,
  });

  await lc.save();
  sendSuccess(res, lc.toJSON(), "Maintenance record added");
});

export const updateMaintenanceReminder = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { id } = req.params;
  const { reminderIndex, status } = req.body;

  const lc = await ProductLifecycle.findOne({ _id: id, userId });
  if (!lc) throw ApiError.notFound("Lifecycle record not found");

  const idx = Number(reminderIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= lc.maintenanceReminders.length) {
    throw ApiError.badRequest("Invalid reminder index");
  }

  lc.maintenanceReminders[idx].status = status || lc.maintenanceReminders[idx].status;
  await lc.save();
  sendSuccess(res, lc.toJSON(), "Maintenance status updated");
});
