import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { handleCustomerCopilotQuery } from "./customer-copilot.service";
import { customerCopilotQuerySchema } from "./customer-copilot.schemas";

export const customerCopilotController = asyncHandler(async (req: Request, res: Response) => {
  const { error, data } = customerCopilotQuerySchema.safeParse(req.body);
  if (error) {
    throw ApiError.badRequest("Invalid request: " + error.errors.map((e) => e.message).join(", "));
  }

  const { query, conversationId } = data;
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const response = conversationId
    ? await handleCustomerCopilotQuery(query, userId, conversationId)
    : await handleCustomerCopilotQuery(query, userId);
  sendSuccess(res, response);
});
