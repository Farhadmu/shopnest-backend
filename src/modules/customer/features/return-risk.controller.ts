import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";

// 10. SMART RETURN RISK PREVIEW
export const getReturnRiskPreview = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const category = product.category.toLowerCase();
  const isFashion = category.includes("fashion") || category.includes("clothing") || category.includes("shoe");

  const riskLevel = isFashion ? "medium" : "low";
  const returnRate = isFashion ? "6.8%" : "1.9%";

  const adviceList = isFashion
    ? [
        "Check accurate bust/waist measurement chart before choosing size.",
        "Fabric color may show slight shade variation under natural sunlight.",
        "Free 7-day size exchange supported across Bangladesh.",
      ]
    : [
        "Ensure power compatibility (220V/50Hz standard in BD).",
        "Retain original packaging and seals for warranty claim eligibility.",
        "Fast doorstep pickup on verified technical defects.",
      ];

  sendSuccess(res, {
    productId,
    riskLevel,
    historicalReturnRate: returnRate,
    topReturnReasons: isFashion ? ["Size/fit mismatch", "Color preference"] : ["Compatibility misunderstanding", "Accidental duplicate order"],
    proactiveAdvice: adviceList,
    guaranteeNotice: "Eligible for ShopNest 7-Day Hassle-Free Return Policy.",
  });
});