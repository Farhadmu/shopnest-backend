import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { ProductReport } from "../customer-extras.model";

export const submitProductReport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, productTitle, category, description, evidenceUrls } = req.body;

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const report = await ProductReport.create({
    userId,
    productId,
    productTitle: productTitle || product.title,
    sellerId: product.sellerId,
    category,
    description,
    evidenceUrls: evidenceUrls || [],
    status: "pending",
  });

  sendSuccess(res, report, "Product report submitted. Our safety team will investigate.");
});

export const getUserProductReports = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await ProductReport.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, reports);
});

// ============================================================
// 17. PERSONAL COMMERCE ASSISTANT (Feature 30)
// ============================================================
