import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { handleAdminCopilotQuery } from "./admin-copilot.service";
import { adminCopilotQuerySchema } from "./admin-copilot.schemas";

export const adminCopilotController = asyncHandler(async (req: Request, res: Response) => {
  const { error, data } = adminCopilotQuerySchema.safeParse(req.body);
  if (error) {
    throw ApiError.badRequest("Invalid request: " + error.errors.map((e) => e.message).join(", "));
  }

  const { query, context } = data;
  const adminId = req.user?.id;

  const response = await handleAdminCopilotQuery(query, adminId);

  sendSuccess(res, response);
});
