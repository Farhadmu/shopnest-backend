import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Order } from "../../orders/order.model";
import { Refund, ReverseDeliveryRequest } from "../customer-features.model";
import { DeliveryManDetails } from "../../delivery/delivery-man.model";
import { DeliveryLocation } from "../../delivery/delivery-location.model";
import { emitDeliveryEvent } from "../../../realtime/socket.server";
import {
  getReturnEligibility,
  createReturnRequest as serviceCreateReturnRequest,
  getCustomerReturns,
  getReturnById as serviceGetReturnById,
  approveReturn,
  rejectReturn,
  inspectReturn,
  getSellerReturns,
  getDeliveryReverseRequests,
  getDeliveryMyReverseRequests,
  acceptReverseDelivery,
  updateReverseDeliveryStatus,
  generateReverseDeliveryOtp,
  verifyReverseDeliveryOtp,
  completePickup,
  startPickup,
  getReverseDeliveryDetails as serviceGetReverseDeliveryDetails,
  processRefund,
  getAdminReturns,
  getAdminReturnDetails,
} from "./returns.service";

export const getReturnEligibilityRoute = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { productId } = req.query;
  const result = await getReturnEligibility(orderId, String(productId), req.user!.id);
  sendSuccess(res, result);
});

export const getCustomerRefunds = asyncHandler(async (req: Request, res: Response) => {
  const refunds = await Refund.find({ customerId: req.user!.id }).sort({ createdAt: -1 }).lean();
  sendSuccess(res, refunds);
});

export const getReturnRequests = asyncHandler(async (req: Request, res: Response) => {
  const returns = await getCustomerReturns(req.user!.id);
  sendSuccess(res, returns);
});

export const createReturnRequest = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = req.body;
  const returnReq = await serviceCreateReturnRequest(userId, {
    orderId: body.orderId,
    orderItemId: body.orderItemId,
    productId: body.productId,
    productTitle: body.productTitle,
    productImage: body.productImage,
    sellerId: body.sellerId,
    sellerName: body.sellerName,
    type: body.type,
    reason: body.reason,
    description: body.description,
    quantity: body.quantity || 1,
    evidenceUrls: body.evidenceUrls || [],
    pickupAddress: body.pickupAddress,
    sellerReturnAddress: body.sellerReturnAddress,
  });
  sendSuccess(res, returnReq, "Return request submitted successfully", 201);
});

export const getReturnDetails = asyncHandler(async (req: Request, res: Response) => {
  const returnReq = await serviceGetReturnById(req.params.id, req.user!.id, req.user!.role);
  sendSuccess(res, returnReq);
});

export const approveReturnRoute = asyncHandler(async (req: Request, res: Response) => {
  const result = await approveReturn(req.params.id, req.user!.id, req.user!.name || "Seller", req.body.note);
  sendSuccess(res, result, "Return approved");
});

export const rejectReturnRoute = asyncHandler(async (req: Request, res: Response) => {
  const { rejectionReason } = req.body;
  const returnReq = await rejectReturn(req.params.id, req.user!.id, req.user!.name || "Seller", rejectionReason);
  sendSuccess(res, returnReq, "Return rejected");
});

export const inspectReturnRoute = asyncHandler(async (req: Request, res: Response) => {
  const { inspectionStatus, inspectionNotes, resalable } = req.body;
  const returnReq = await inspectReturn(req.params.id, req.user!.id, req.user!.name || "Seller", inspectionStatus, inspectionNotes, resalable);
  sendSuccess(res, returnReq, "Inspection updated");
});

export const getSellerReturnsRoute = asyncHandler(async (req: Request, res: Response) => {
  const returns = await getSellerReturns(req.user!.id);
  sendSuccess(res, returns);
});

export const getDeliveryReverseRequestsRoute = asyncHandler(async (req: Request, res: Response) => {
  const requests = await getDeliveryReverseRequests(req.user!.id);
  sendSuccess(res, requests);
});

export const getDeliveryMyReverseRequestsRoute = asyncHandler(async (req: Request, res: Response) => {
  const requests = await getDeliveryMyReverseRequests(req.user!.id);
  sendSuccess(res, requests);
});

export const acceptReverseDeliveryRoute = asyncHandler(async (req: Request, res: Response) => {
  const claimed = await acceptReverseDelivery(req.params.id, req.user!.id, req.user!.name || "Delivery Partner");
  sendSuccess(res, claimed, "Reverse delivery accepted successfully");
});

export const updateReverseDeliveryStatusRoute = asyncHandler(async (req: Request, res: Response) => {
  const { status, failureReason, deliveryOtp, deliveryProofImage, note } = req.body;
  const reverse = await updateReverseDeliveryStatus(req.params.id, status, req.user!.id, req.user!.role, {
    failureReason,
    deliveryOtp,
    deliveryProofImage,
    note,
  });
  sendSuccess(res, reverse, "Reverse delivery status updated");
});

export const getReverseDeliveryDetails = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const role = req.user!.role;
  const details = await serviceGetReverseDeliveryDetails(id, userId, role);
  sendSuccess(res, details);
});

export const generateReverseOtpRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const otp = await generateReverseDeliveryOtp(id, req.user!.id);
  sendSuccess(res, { deliveryOtp: otp }, "OTP generated for pickup verification");
});

export const verifyReverseOtpRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { otp } = req.body;
  const result = await verifyReverseDeliveryOtp(id, otp, req.user!.id, req.user!.role);
  sendSuccess(res, result, "OTP verified successfully");
});

export const startReversePickupRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body;
  const reverse = await startPickup(id, req.user!.id, note);
  sendSuccess(res, reverse, "Pickup started");
});

export const completeReversePickupRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { deliveryProofImage, note } = req.body;
  const reverse = await completePickup(id, req.user!.id, deliveryProofImage, note);
  sendSuccess(res, reverse, "Pickup completed successfully");
});

const reverseLocationBreadcrumbMap = new Map<string, number>();

export const updateReverseDeliveryLocationRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { latitude, longitude, accuracy, altitude, speed, heading } = req.body as {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
  };

  const reverse = await ReverseDeliveryRequest.findById(id);
  if (!reverse) throw ApiError.notFound("Reverse delivery request not found");
  if (reverse.assignedDeliveryManId !== req.user!.id && req.user!.role !== "admin") {
    throw ApiError.forbidden("You are not assigned to this reverse delivery");
  }

  const now = new Date();

  await DeliveryManDetails.findOneAndUpdate(
    { userId: req.user!.id },
    {
      $set: {
        isActive: true,
        lastActiveAt: now,
        "currentLocation.latitude": latitude,
        "currentLocation.longitude": longitude,
        "currentLocation.speed": speed,
        "currentLocation.heading": heading,
        "currentLocation.accuracy": accuracy,
        "currentLocation.updatedAt": now,
      },
    },
    { upsert: true }
  );

  const lastBreadcrumb = reverseLocationBreadcrumbMap.get(id) || 0;
  if (Date.now() - lastBreadcrumb > 10_000) {
    reverseLocationBreadcrumbMap.set(id, Date.now());
    await DeliveryLocation.create({
      deliveryRequestId: id,
      deliveryManId: req.user!.id,
      latitude,
      longitude,
      accuracy,
      altitude,
      speed,
      heading,
      recordedAt: now,
    });
  }

  // Broadcast realtime location update to reverse delivery tracking room
  emitDeliveryEvent(id, "delivery:location_update", {
    deliveryId: id,
    orderId: reverse.orderId,
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    status: reverse.status,
    updatedAt: now.toISOString(),
  });

  sendSuccess(res, { success: true, message: "Location updated" });
});

export const getRefundDetails = asyncHandler(async (req: Request, res: Response) => {
  const refund = await Refund.findOne({ refundId: req.params.id }).lean();
  if (!refund) throw ApiError.notFound("Refund not found");
  sendSuccess(res, refund);
});

export const processRefundRoute = asyncHandler(async (req: Request, res: Response) => {
  const result = await processRefund(req.params.id, req.user!.id, req.user!.role);
  sendSuccess(res, result, "Refund processed successfully");
});

export const getAdminReturnsRoute = asyncHandler(async (req: Request, res: Response) => {
  const filters = {
    status: req.query.status as string | undefined,
    refundStatus: req.query.refundStatus as string | undefined,
    sellerId: req.query.sellerId as string | undefined,
    customerId: req.query.customerId as string | undefined,
    search: req.query.search as string | undefined,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
  };
  const result = await getAdminReturns(filters);
  sendSuccess(res, result);
});

export const getAdminReturnDetailsRoute = asyncHandler(async (req: Request, res: Response) => {
  const details = await getAdminReturnDetails(req.params.id);
  sendSuccess(res, details);
});
