import { Types } from "mongoose";
import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { ReturnRequest } from "../../customer/customer-features.model";
import { Refund } from "../../customer/customer-features.model";
import { ReverseDeliveryRequest } from "../../customer/customer-features.model";

async function findRefund(id: string) {
  if (Types.ObjectId.isValid(id)) {
    const byId = await Refund.findById(id);
    if (byId) return byId;
  }
  return Refund.findOne({ refundId: String(id) });
}

export const getAdminReturns = asyncHandler(async (req: Request, res: Response) => {
  const { status, sellerId, customerId, productId, search } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};

  if (status && status !== "all") filter.status = status;
  if (sellerId) filter.sellerId = sellerId;
  if (customerId) filter.userId = customerId;
  if (productId) filter.productId = productId;
  if (search) {
    filter.$or = [
      { orderId: { $regex: search, $options: "i" } },
      { productTitle: { $regex: search, $options: "i" } },
      { reason: { $regex: search, $options: "i" } },
    ];
  }

  const returns = await ReturnRequest.find(filter).sort({ createdAt: -1 }).lean();
  sendSuccess(res, returns);
});

export const getAdminReturnDetails = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const returnReq = await ReturnRequest.findById(id).lean();
  if (!returnReq) throw ApiError.notFound("Return request not found");

  const [refunds, reverseDelivery] = await Promise.all([
    Refund.find({ returnRequestId: id }).sort({ createdAt: -1 }).lean(),
    ReverseDeliveryRequest.findOne({ returnRequestId: id }).lean(),
  ]);

  sendSuccess(res, { returnRequest: returnReq, refunds, reverseDelivery });
});

export const getAdminReturnById = getAdminReturnDetails;

export const getAdminRefunds = asyncHandler(async (req: Request, res: Response) => {
  const { status, customerId, sellerId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (customerId) filter.customerId = customerId;
  if (sellerId) filter.sellerId = sellerId;

  const refunds = await Refund.find(filter).sort({ createdAt: -1 }).lean();
  sendSuccess(res, refunds);
});

export const processRefund = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const refund = await findRefund(id);
  if (!refund) throw ApiError.notFound("Refund not found");
  if (refund.status !== "pending") throw ApiError.badRequest("Refund is not in pending state");

  refund.status = "processing";
  refund.processedAt = new Date();
  await refund.save();

  const returnReq = await ReturnRequest.findOne({ refundId: refund.refundId });
  if (returnReq) {
    returnReq.status = "refund_processing";
    returnReq.statusHistory.push({ status: "refund_processing", at: new Date(), note: "Refund processing started" });
    await returnReq.save();
  }

  sendSuccess(res, refund, "Refund processing started");
});

export const markRefundSucceeded = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const refund = await findRefund(id);
  if (!refund) throw ApiError.notFound("Refund not found");

  refund.status = "succeeded";
  refund.processedAt = new Date();
  await refund.save();

  const returnReq = await ReturnRequest.findOne({ refundId: refund.refundId });
  if (returnReq) {
    returnReq.status = "refunded";
    returnReq.statusHistory.push({ status: "refunded", at: new Date(), note: "Refund completed" });
    await returnReq.save();
  }

  sendSuccess(res, refund, "Refund marked as succeeded");
});

export const markRefundFailed = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { failureReason } = req.body;
  const refund = await findRefund(id);
  if (!refund) throw ApiError.notFound("Refund not found");

  refund.status = "failed";
  refund.failedAt = new Date();
  if (failureReason) refund.failureReason = failureReason;
  await refund.save();

  const returnReq = await ReturnRequest.findOne({ refundId: refund.refundId });
  if (returnReq) {
    returnReq.status = "refund_failed";
    returnReq.statusHistory.push({ status: "refund_failed", at: new Date(), note: failureReason || "Refund failed" });
    await returnReq.save();
  }

  sendSuccess(res, refund, "Refund marked as failed");
});
