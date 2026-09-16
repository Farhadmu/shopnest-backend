import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { handleDeliveryCopilotQuery } from "./delivery-copilot.service";

export const chatDeliveryCopilot = asyncHandler(async (req: Request, res: Response) => {
  const { query, conversationMessages } = req.body as {
    query: string;
    conversationMessages?: Array<{ role: string; content: string }>;
  };

  const userId = req.user!.id;
  const result = await handleDeliveryCopilotQuery(query, userId, conversationMessages);

  sendSuccess(res, result, "Delivery Copilot response generated");
});
