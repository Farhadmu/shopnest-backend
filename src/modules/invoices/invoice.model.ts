import { Schema, model, Types } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IInvoiceItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
  discount: number;
  total: number;
}

export interface IInvoice {
  _id: Types.ObjectId;
  invoiceNumber: string;
  orderId: string;
  userId: string;
  sellerId: string;
  storeId: string;
  items: IInvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee: number;
  totalAmount: number;
  currency: string;
  language: string;
  pdfUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceItemSchema = new Schema<IInvoiceItem>(
  {
    productId: { type: String, required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const invoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    items: { type: [invoiceItemSchema], required: true, default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "BDT" },
    language: { type: String, required: true, default: "en" },
    pdfUrl: { type: String, required: true },
  },
  { timestamps: true }
);

invoiceSchema.index({ orderId: 1 });
invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ sellerId: 1, createdAt: -1 });

applyToJSON(invoiceSchema);

export const Invoice = model<IInvoice>("Invoice", invoiceSchema);
