import { Request, Response } from "express";
import { Invoice } from "./invoice.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

function generateInvoiceNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${ts}-${rand}`;
}

export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const invoice = await Invoice.findOne({ orderId });

  if (!invoice) {
    throw ApiError.notFound("Invoice not found for this order");
  }

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.userId === req.user?.id;
  const isSeller = order.items.some((i) => i.sellerId === req.user?.id);
  if (!isOwner && !isSeller && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot view this invoice");
  }

  sendSuccess(res, invoice);
});

export const generateInvoice = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, language = "en", currency = "BDT" } = req.body as {
    orderId: string;
    language?: string;
    currency?: string;
  };

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const isSeller = order.items.some((i) => i.sellerId === req.user?.id);
  if (!isSeller && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot generate invoice for this order");
  }

  const existing = await Invoice.findOne({ orderId });
  if (existing) {
    sendSuccess(res, existing, "Invoice already generated");
    return;
  }

  const items = order.items.map((item) => ({
    productId: item.productId,
    title: item.title,
    quantity: item.quantity,
    price: item.price,
    discount: 0,
    total: Math.round(item.price * item.quantity * 100) / 100,
  }));

  const subtotal = Math.round(items.reduce((sum, i) => sum + i.total, 0) * 100) / 100;
  const deliveryFee = Math.round((subtotal > 500 ? 0 : 60) * 100) / 100;
  const totalAmount = Math.round((subtotal + deliveryFee - order.discount) * 100) / 100;

  const invoice = await Invoice.create({
    invoiceNumber: generateInvoiceNumber(),
    orderId: order.id,
    userId: order.userId,
    sellerId: order.items[0]?.sellerId || req.user!.id,
    storeId: order.items[0]?.storeId || "",
    items,
    subtotal,
    discount: order.discount || 0,
    tax: 0,
    deliveryFee,
    totalAmount,
    currency,
    language,
    pdfUrl: `https://api.shopnest.local/invoices/${orderId}.pdf`,
  });

  sendSuccess(res, invoice, "Invoice generated successfully", 201);
});

export const listSellerInvoices = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const invoices = await Invoice.find({ sellerId }).sort({ createdAt: -1 }).limit(100);
  sendSuccess(res, invoices);
});
