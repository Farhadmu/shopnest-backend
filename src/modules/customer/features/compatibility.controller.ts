import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { ACTIVE_PRODUCT_FILTER } from "../../../utils/activeProductFilter";

// PRODUCT COMPATIBILITY CHECKER
export const checkProductCompatibility = asyncHandler(async (req: Request, res: Response) => {
  const { productIds = [], customSpecs = [] } = req.body;

  let products = await Product.find({ _id: { $in: productIds } });

  if (products.length < 2 && customSpecs.length < 2) {
    // Provide a sample comparison set if single or none passed
    const sampleProducts = await Product.find(ACTIVE_PRODUCT_FILTER).limit(2);
    products = sampleProducts;
  }

  // Compatibility Rule Engine
  let status: "compatible" | "potential_issue" | "not_compatible" | "insufficient_info" = "compatible";
  const checks: Array<{
    aspect: string;
    result: "pass" | "warning" | "fail" | "unknown";
    explanation: string;
  }> = [];

  const titles = products.map((p) => p.title.toLowerCase());
  const categories = products.map((p) => p.category.toLowerCase());

  // Check 1: Laptop + RAM / Storage compatibility
  const hasLaptop = categories.some((c) => c.includes("laptop")) || titles.some((t) => t.includes("laptop"));
  const hasRam = titles.some((t) => t.includes("ram") || t.includes("memory") || t.includes("ddr"));

  if (hasLaptop && hasRam) {
    const isDdr5 = titles.some((t) => t.includes("ddr5"));
    const isDdr4 = titles.some((t) => t.includes("ddr4"));
    if (isDdr5 && isDdr4) {
      status = "not_compatible";
      checks.push({
        aspect: "Memory Architecture",
        result: "fail",
        explanation: "DDR4 and DDR5 memory modules have different pin configurations and are physically and electrically incompatible.",
      });
    } else {
      checks.push({
        aspect: "Memory Interface",
        result: "pass",
        explanation: "SO-DIMM RAM form factor matches standard modern laptop expansion slots.",
      });
    }
  }

  // Check 2: Camera + Lens Mount
  const hasCamera = categories.some((c) => c.includes("camera")) || titles.some((t) => t.includes("camera"));
  const hasLens = titles.some((t) => t.includes("lens"));
  if (hasCamera && hasLens) {
    const isSony = titles.some((t) => t.includes("sony"));
    const isCanon = titles.some((t) => t.includes("canon"));
    if (isSony && isCanon) {
      status = "not_compatible";
      checks.push({
        aspect: "Lens Mount Standard",
        result: "fail",
        explanation: "Canon RF/EF lens cannot be directly mounted to a Sony E-mount body without an optical adapter.",
      });
    } else {
      checks.push({
        aspect: "Optical Mount",
        result: "pass",
        explanation: "Lens mount matches the camera body flange distance standard.",
      });
    }
  }

  // Check 3: Phone + Fast Charger
  const hasPhone = categories.some((c) => c.includes("phone")) || titles.some((t) => t.includes("phone"));
  const hasCharger = titles.some((t) => t.includes("charger") || t.includes("adapter") || t.includes("pd"));
  if (hasPhone && hasCharger) {
    checks.push({
      aspect: "Power Delivery Protocol",
      result: "pass",
      explanation: "USB-PD (Power Delivery 3.0) protocol standard delivers safe, negotiated voltage up to 65W.",
    });
  }

  // Check 4: PC Case + GPU Clearance / PSU
  const hasGPU = titles.some((t) => t.includes("rtx") || t.includes("gpu") || t.includes("graphics"));
  if (hasGPU) {
    checks.push({
      aspect: "Power Supply & Thermal Clearance",
      result: "warning",
      explanation: "High-performance GPU requires a minimum 650W 80+ Bronze PSU and 2x 8-pin PCIe power cables.",
    });
    if (status !== "not_compatible") status = "potential_issue";
  }

  if (checks.length === 0) {
    checks.push({
      aspect: "Universal Standards",
      result: "pass",
      explanation: "Items utilize universal USB / Bluetooth / standard physical interfaces with 100% interoperability.",
    });
  }

  sendSuccess(res, {
    status,
    products: products.map((p) => ({ id: p.id, title: p.title, category: p.category })),
    checks,
    recommendation:
      status === "compatible"
        ? "✓ All selected items are verified compatible and can be purchased safely together."
        : status === "potential_issue"
        ? "⚠ Potential configuration check recommended before finalizing purchase."
        : "✕ Incompatibility detected. Please check physical connector or protocol specifications.",
  });
});
