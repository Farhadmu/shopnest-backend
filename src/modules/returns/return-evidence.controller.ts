import { Request, Response } from "express";
import { ReturnEvidence } from "./return-evidence.model";
import { Order } from "../orders/order.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const submitReturnEvidence = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId, productId, images, description, issueType, videos } = req.body;

  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");

  if (order.status !== "delivered" && order.status !== "returned") {
    throw ApiError.badRequest("Evidence can only be submitted for delivered orders");
  }

  const returnId = `RET-${orderId}-${productId}`;

  const evidence = await ReturnEvidence.findOneAndUpdate(
    { returnId },
    {
      returnId,
      orderId,
      userId,
      productId,
      images,
      description,
      issueType,
      videos: videos || [],
      status: "pending",
      submittedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  sendSuccess(res, evidence, "Return evidence submitted", 201);
});

export const getReturnEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = req.params;
  const evidence = await ReturnEvidence.findOne({ returnId });
  if (!evidence) throw ApiError.notFound("Return evidence not found");

  const isOwner = evidence.userId === req.user?.id;
  if (!isOwner && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot view this evidence");
  }

  sendSuccess(res, evidence);
});

export const getOrderEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const evidenceList = await ReturnEvidence.find({ orderId }).sort({ submittedAt: -1 });

  const isOwner = evidenceList.length === 0 || evidenceList[0].userId === req.user?.id;
  if (!isOwner && req.user?.role !== "admin") {
    throw ApiError.forbidden("You cannot view this evidence");
  }

  sendSuccess(res, evidenceList);
});
