import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { handleSellerCopilotQuery } from "./seller-copilot.service";
import { sellerCopilotQuerySchema } from "./seller-copilot.schemas";

export const sellerCopilotController = asyncHandler(async (req: Request, res: Response) => {
  const { error, data } = sellerCopilotQuerySchema.safeParse(req.body);
  if (error) {
    throw ApiError.badRequest("Invalid request: " + error.errors.map((e) => e.message).join(", "));
  }

  const { query } = data;
  const sellerId = req.user?.id;
  if (!sellerId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const response = await handleSellerCopilotQuery(query, sellerId);
  sendSuccess(res, response);
});
