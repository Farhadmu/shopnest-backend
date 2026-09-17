import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { validate } from "../../middlewares/validate.middleware";
import { ApiError } from "../../utils/api-error";
import {
  createComplaint,
  getMyComplaints,
  getMyComplaintById,
  type CreateComplaintInput,
  type ComplaintAuthor,
} from "./complaint.service";
import { createComplaintSchema, complaintQuerySchema } from "../../schemas/complaint.schema";

function buildAttachments(files: Express.Multer.File[] | undefined): string[] {
  if (!files || files.length === 0) return [];
  return files.map((file) => `/uploads/complaints/${file.filename}`);
}

function prepareCreateComplaintInput(req: Request, role: ComplaintAuthor["role"]): CreateComplaintInput {
  const body = createComplaintSchema.parse(req.body);
  const attachments = buildAttachments(req.files as Express.Multer.File[] | undefined);

  return {
    ...body,
    attachments,
    author: {
      id: req.user?.id || "",
      name: req.user?.name || role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      role,
    },
  };
}

export const createCustomerComplaint = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const complaint = await createComplaint(prepareCreateComplaintInput(req, "customer"));
  sendSuccess(res, complaint, "Complaint submitted successfully", 201);
});

export const getCustomerComplaints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { page, limit, status } = complaintQuerySchema.parse(req.query);
  const result = await getMyComplaints(userId, "customer");
  sendSuccess(res, { items: result.items, pagination: { total: result.total, page, limit } });
});

export const getCustomerComplaintById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { id } = req.params;
  const complaint = await getMyComplaintById(id, userId, "customer");
  if (!complaint) throw ApiError.notFound("Complaint not found");
  sendSuccess(res, complaint);
});

export const createDeliveryComplaint = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const complaint = await createComplaint(prepareCreateComplaintInput(req, "delivery_man"));
  sendSuccess(res, complaint, "Complaint submitted successfully", 201);
});

export const getDeliveryComplaints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { page, limit, status } = complaintQuerySchema.parse(req.query);
  const result = await getMyComplaints(userId, "delivery_man");
  sendSuccess(res, { items: result.items, pagination: { total: result.total, page, limit } });
});

export const getDeliveryComplaintById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { id } = req.params;
  const complaint = await getMyComplaintById(id, userId, "delivery_man");
  if (!complaint) throw ApiError.notFound("Complaint not found");
  sendSuccess(res, complaint);
});

export const createSellerComplaint = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const complaint = await createComplaint(prepareCreateComplaintInput(req, "seller"));
  sendSuccess(res, complaint, "Complaint submitted successfully", 201);
});

export const getSellerComplaints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { page, limit, status } = complaintQuerySchema.parse(req.query);
  const result = await getMyComplaints(userId, "seller");
  sendSuccess(res, { items: result.items, pagination: { total: result.total, page, limit } });
});

export const getSellerComplaintById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { id } = req.params;
  const complaint = await getMyComplaintById(id, userId, "seller");
  if (!complaint) throw ApiError.notFound("Complaint not found");
  sendSuccess(res, complaint);
});
