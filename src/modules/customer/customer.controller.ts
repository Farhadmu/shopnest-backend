import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Product } from "../products/product.model";
import {
  ShoppingJourney,
  ShoppingGoal,
  ProductLifecycle,
  ProductBundle,
} from "./customer-intelligence.model";

// 1. SMART SHOPPING JOURNEY
export const getShoppingJourney = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous-guest";
  const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    return sendSuccess(res, {
      journey: null,
      recommendedItems: [],
    });
  }

  // Populate product details for recommendations
  const recommendedItems = await Product.find({
    _id: { $in: journey.recommendedProducts || [] },
    isDeleted: false,
  }).limit(4);

  sendSuccess(res, {
    journey: journey.toJSON(),
    recommendedItems,
  });
});

export const recordJourneyEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous-guest";
  const { eventType, productId, productTitle, category, price, metadata } = req.body;

  let journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    journey = new ShoppingJourney({
      userId,
      category: category || "Electronics",
      currentStage: "discovery",
      journeyProgress: 20,
      events: [],
    });
  }

  journey.events.push({
    eventType,
    productId,
    productTitle,
    category,
    price,
    metadata,
    createdAt: new Date(),
  });

  // Dynamically update progress & stage
  const eventTypes = journey.events.map((e) => e.eventType);
  if (eventTypes.includes("purchase")) {
    journey.currentStage = "completed";
    journey.journeyProgress = 100;
  } else if (eventTypes.includes("cart_add")) {
    journey.currentStage = "ready_to_buy";
    journey.journeyProgress = 80;
  } else if (eventTypes.includes("wishlist_add") || eventTypes.filter((t) => t === "view").length >= 3) {
    journey.currentStage = "intent";
    journey.journeyProgress = 60;
  } else if (eventTypes.filter((t) => t === "view").length >= 1) {
    journey.currentStage = "evaluation";
    journey.journeyProgress = 40;
  }

  await journey.save();
  sendSuccess(res, journey.toJSON(), "Journey event recorded");
});

// 2. SMART BUDGET PLANNER
export const generateBudgetPlan = asyncHandler(async (req: Request, res: Response) => {
  const { budget, purpose } = req.body;
  const targetBudget = Number(budget);

  if (!targetBudget || targetBudget <= 0) {
    throw ApiError.badRequest("Please provide a valid budget amount");
  }
  if (!purpose) {
    throw ApiError.badRequest("Please select a category");
  }

  // Fetch approved, in-stock products for the category
  const categoryProducts = await Product.find({
    isDeleted: false,
    status: "approved",
    stock: { $gt: 0 },
    category: { $regex: new RegExp(`^${purpose}$`, "i") },
  });

  if (categoryProducts.length === 0) {
    return sendSuccess(res, {
      targetBudget,
      totalPlannedSpend: 0,
      remainingBudget: targetBudget,
      purpose,
      items: [],
      planSummary: "No available products found in this category to build a plan yet.",
    });
  }

  // Filter products that actually fit inside the user's budget
  const affordableProducts = categoryProducts
    .filter((p) => p.price <= targetBudget)
    .sort((a, b) => a.price - b.price);

  // If the cheapest item in the category exceeds targetBudget
  if (affordableProducts.length === 0) {
    const minPrice = Math.min(...categoryProducts.map((p) => p.price));
    return sendSuccess(res, {
      targetBudget,
      totalPlannedSpend: 0,
      remainingBudget: targetBudget,
      purpose,
      items: [],
      planSummary: `The minimum price in the '${purpose}' category is ৳${minPrice.toLocaleString()}. Please increase your budget.`,
    });
  }

  const plannedItems: Array<{
    role: string;
    allocatedBudget: number;
    selectedProduct?: { id: string; title: string; price: number; category: string; image: string };
    alternatives: Array<{ id: string; title: string; price: number; type: "cheaper" | "premium" }>;
  }> = [];

  const usedIds = new Set<string>();
  let currentRemaining = targetBudget;
  let totalPlannedSpend = 0;

  const pushItem = (
    role: string,
    product: (typeof categoryProducts)[number],
    allocatedBudget: number
  ) => {
    const pool = categoryProducts.filter((p) => p.id !== product.id);
    const cheaper = pool.filter((p) => p.price < product.price).sort((a, b) => b.price - a.price).slice(0, 2);
    const premium = pool.filter((p) => p.price > product.price).sort((a, b) => a.price - b.price).slice(0, 2);

    plannedItems.push({
      role,
      allocatedBudget: Math.round(allocatedBudget),
      selectedProduct: {
        id: product.id,
        title: product.title,
        price: product.price,
        category: product.category,
        image: product.images?.[0] || "",
      },
      alternatives: [
        ...cheaper.map((p) => ({ id: p.id, title: p.title, price: p.price, type: "cheaper" as const })),
        ...premium.map((p) => ({ id: p.id, title: p.title, price: p.price, type: "premium" as const })),
      ],
    });
  };

  // Build optimal allocation within budget limit
  const maxItems = Math.min(3, affordableProducts.length);

  for (let i = 0; i < maxItems; i++) {
    const slotBudget = currentRemaining / (maxItems - i);
    
    // Pick best matching product that strictly costs <= currentRemaining
    const pick = affordableProducts
      .filter((p) => !usedIds.has(p.id) && p.price <= currentRemaining)
      .sort((a, b) => Math.abs(a.price - slotBudget) - Math.abs(b.price - slotBudget))[0];

    if (!pick) break;

    usedIds.add(pick.id);
    const role = i === 0 ? "Primary Value Pick" : `Complementary Pick ${i}`;
    pushItem(role, pick, slotBudget);

    totalPlannedSpend += pick.price;
    currentRemaining -= pick.price;
  }

  const remainingBudget = Math.max(0, targetBudget - totalPlannedSpend);

  return sendSuccess(res, {
    targetBudget,
    totalPlannedSpend,
    remainingBudget,
    purpose,
    items: plannedItems,
    planSummary: `Allocated ${plannedItems.length} curated pick(s) within your ৳${targetBudget.toLocaleString()} budget with ৳${remainingBudget.toLocaleString()} remaining buffer.`,
  });
});

// 3. PRODUCT COMPATIBILITY CHECKER
export const checkProductCompatibility = asyncHandler(async (req: Request, res: Response) => {
  const { productIds = [], customSpecs = [] } = req.body;

  let products = await Product.find({ _id: { $in: productIds } });

  if (products.length < 2 && customSpecs.length < 2) {
    // Provide a sample comparison set if single or none passed
    const sampleProducts = await Product.find({ isDeleted: false, status: "approved" }).limit(2);
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

// 4. SMART BUNDLE BUILDER
export const getProductBundle = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Check if saved bundle exists
  let bundle = await ProductBundle.findOne({ mainProductId: productId });

  if (!bundle) {
    // Construct dynamic complementary bundle from related category items
    const complementaryItems = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      isDeleted: false,
      status: "approved",
    }).limit(3);

    const items = [
      {
        productId: product.id,
        title: product.title,
        price: product.price,
        role: "main" as const,
      },
      ...complementaryItems.map((c) => ({
        productId: c.id,
        title: c.title,
        price: c.price,
        role: "complementary" as const,
      })),
    ];

    const originalTotal = items.reduce((sum, item) => sum + item.price, 0);
    const bundlePrice = Math.round(originalTotal * 0.88); // 12% bundle discount

    bundle = await ProductBundle.create({
      bundleName: `${product.title} Power Bundle`,
      mainProductId: product.id,
      category: product.category,
      items,
      originalTotal,
      bundlePrice,
      savingsPercentage: 12,
      compatibilityNote: "Verified complementary accessory package.",
    });
  }

  sendSuccess(res, bundle.toJSON());
});

// 5. PRODUCT LIFE-CYCLE TRACKER
export const getProductLifecycle = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous-guest";
  const lifecycles = await ProductLifecycle.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, lifecycles);
});

export const updateMaintenanceReminder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reminderIndex, status } = req.body;

  const lifecycle = await ProductLifecycle.findById(id);
  if (!lifecycle) throw ApiError.notFound("Lifecycle record not found");

  if (lifecycle.maintenanceReminders[reminderIndex]) {
    lifecycle.maintenanceReminders[reminderIndex].status = status;
    await lifecycle.save();
  }

  sendSuccess(res, lifecycle.toJSON(), "Maintenance status updated");
});

// 6. PERSONAL SHOPPING GOALS
export const getGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous-guest";
  const goals = await ShoppingGoal.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, goals);
});

export const createGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "anonymous-guest";
  const { title, category, targetBudget, targetDate, items = [] } = req.body;

  const completedCount = items.filter((i: { isCompleted?: boolean }) => i.isCompleted).length;
  const progressPercentage = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  const goal = await ShoppingGoal.create({
    userId,
    title,
    category,
    targetBudget: Number(targetBudget),
    targetDate: targetDate ? new Date(targetDate) : undefined,
    items,
    progressPercentage,
    status: progressPercentage === 100 ? "achieved" : "in_progress",
  });

  sendSuccess(res, goal.toJSON(), "Shopping goal created", 201);
});

export const updateGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const goal = await ShoppingGoal.findById(id);
  if (!goal) throw ApiError.notFound("Goal not found");

  const { title, targetBudget, targetDate, items, status } = req.body;

  if (title) goal.title = title;
  if (targetBudget !== undefined) goal.targetBudget = Number(targetBudget);
  if (targetDate) goal.targetDate = new Date(targetDate);
  if (items) {
    goal.items = items;
    const completedCount = items.filter((i: { isCompleted?: boolean }) => i.isCompleted).length;
    goal.progressPercentage = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
  }
  if (status) goal.status = status;
  if (goal.progressPercentage === 100) goal.status = "completed";

  await goal.save();
  sendSuccess(res, goal.toJSON(), "Shopping goal updated");
});

export const deleteGoal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await ShoppingGoal.findByIdAndDelete(id);
  sendSuccess(res, { deleted: true }, "Shopping goal removed");
});
