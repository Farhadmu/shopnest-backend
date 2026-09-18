import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import {
  getSellerReturns as serviceGetSellerReturns,
  getReturnById as serviceGetReturnById,
  approveReturn as serviceApproveReturn,
  rejectReturn as serviceRejectReturn,
  inspectReturn as serviceInspectReturn,
  sellerReceiveReturn,
  processRefund as serviceProcessRefund,
} from "../customer/features/returns.service";

export const getSellerReturns = asyncHandler(async (req: Request, res: Response) => {
  const returns = await serviceGetSellerReturns(req.user!.id);
  sendSuccess(res, returns);
});

export const getSellerReturnDetails = asyncHandler(async (req: Request, res: Response) => {
  const returnReq = await serviceGetReturnById(req.params.id, req.user!.id, req.user!.role);
  sendSuccess(res, returnReq);
});

export const approveReturn = asyncHandler(async (req: Request, res: Response) => {
  const result = await serviceApproveReturn(req.params.id, req.user!.id, req.user!.name || "Seller", req.body.note);
  sendSuccess(res, result, "Return approved");
});

export const rejectReturn = asyncHandler(async (req: Request, res: Response) => {
  const { rejectionReason } = req.body;
  const returnReq = await serviceRejectReturn(req.params.id, req.user!.id, req.user!.name || "Seller", rejectionReason);
  sendSuccess(res, returnReq, "Return rejected");
});

export const inspectReturn = asyncHandler(async (req: Request, res: Response) => {
  const { inspectionStatus, inspectionNotes, resalable } = req.body;
  const returnReq = await serviceInspectReturn(req.params.id, req.user!.id, req.user!.name || "Seller", inspectionStatus, inspectionNotes, resalable);
  sendSuccess(res, returnReq, "Inspection updated");
});

export const receiveReturn = asyncHandler(async (req: Request, res: Response) => {
  const { proofImage, note } = req.body;
  const returnReq = await sellerReceiveReturn(req.params.id, req.user!.id, proofImage, note);
  sendSuccess(res, returnReq, "Return received successfully");
});

export const processRefund = asyncHandler(async (req: Request, res: Response) => {
  const result = await serviceProcessRefund(req.params.id, req.user!.id, req.user!.role);
  sendSuccess(res, result, "Refund processed successfully");
});
