import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Order } from "../../orders/order.model";
import { PurchaseDocument } from "../customer-features.model";

export const getPurchaseVault = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.query as { type?: string };
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (type) filter.type = type;
  const documents = await PurchaseDocument.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, documents);
});

export const getPurchaseDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await PurchaseDocument.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!doc) throw ApiError.notFound("Document not found");
  sendSuccess(res, doc);
});

// ============================================================
// WARRANTY MANAGER (Feature 23)
// ============================================================

export const getWarranties = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ userId: req.user!.id, status: "delivered" }).sort({ createdAt: -1 });
  const warranties = orders.flatMap((order) =>
    order.items.map((item: { productId: string; title: string; sellerId: string; category?: string }) => ({
      orderId: order.id, productId: item.productId, productTitle: item.title,
      category: item.category || "General", purchaseDate: order.createdAt,
      warrantyDuration: "1 Year", warrantyExpiry: new Date(new Date(order.createdAt).setFullYear(new Date(order.createdAt).getFullYear() + 1)),
      sellerId: item.sellerId, status: "active" as const,
    }))
  );
  sendSuccess(res, warranties);
});

// ============================================================
// CUSTOMER-SELLER COMMUNICATION (Feature 24)
// ============================================================
