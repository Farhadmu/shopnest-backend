import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Coupon, ICoupon, computeDiscount } from "./coupon.model";
import { Category } from "../categories/category.model";
import { getSettingsSingleton } from "../settings/admin-settings.model";
import { createNotification } from "../notifications/notification.service";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOMEPAGE_RUNNING_SLOTS = 3;

/** Resolves the category name list a coupon (or raw request body) targets. */
function resolveCategoryNames(source: { categories?: string[]; category?: string }): string[] {
  if (source.categories && source.categories.length > 0) return source.categories;
  if (source.category) return [source.category];
  return [];
}

/**
 * Creation-time guard: a seller cannot submit a "specific-category" coupon
 * (any placement) for a category already locked/assigned to a different seller.
 */
async function assertCategoriesNotLockedToOtherSeller(
  body: { scope?: string; categories?: string[]; category?: string },
  sellerId: string
) {
  if (body.scope !== "specific-category") return;
  const catNames = resolveCategoryNames(body);
  if (catNames.length === 0) return;

  const conflict = await Category.findOne({
    name: { $in: catNames },
    is_locked: true,
    assigned_seller_id: { $ne: sellerId },
  });
  if (conflict) {
    throw ApiError.conflict(`Category "${conflict.name}" is already locked to another seller`);
  }
}

/**
 * Creation/Update-time guard: enforces that seller cannot select more categories
 * than the admin-configured global category_length limit for homepage coupons.
 */
async function assertCategoryLimitNotExceeded(
  body: { scope?: string; placement?: string; categories?: string[]; category?: string }
) {
  if (body.placement !== "homepage") return;
  if (body.scope !== "specific-category") return;
  const catNames = resolveCategoryNames(body);
  if (catNames.length === 0) return;

  const settings = await getSettingsSingleton();
  if (catNames.length > settings.category_length) {
    throw ApiError.badRequest(
      `You cannot select ${catNames.length} categories for homepage coupons. Platform limit set by admin is ${settings.category_length}.`
    );
  }
}

/**
 * Approval-time Category Allocation & Lock: locks every category on a
 * "specific-category" coupon to its seller, enforcing the admin's global
 * `category_length` limit and rejecting categories locked to someone else.
 */
async function lockCategoriesForSeller(coupon: ICoupon) {
  if (coupon.scope !== "specific-category") return;
  const catNames = resolveCategoryNames(coupon);
  if (catNames.length === 0) return;

  const categoryDocs = await Category.find({ name: { $in: catNames } });

  const conflicted = categoryDocs.find(
    (c) => c.is_locked && String(c.assigned_seller_id) !== String(coupon.createdBy)
  );
  if (conflicted) {
    throw ApiError.conflict(`Category "${conflicted.name}" is already locked to another seller`);
  }

  const toLock = categoryDocs.filter((c) => !c.is_locked);
  if (toLock.length > 0) {
    const settings = await getSettingsSingleton();
    const currentlyLocked = await Category.countDocuments({ is_locked: true });
    if (currentlyLocked + toLock.length > settings.category_length) {
      throw ApiError.badRequest(
        `Approving this request would lock ${toLock.length} more categor${toLock.length === 1 ? "y" : "ies"}, exceeding the platform limit of ${settings.category_length}.`
      );
    }
  }

  await Category.updateMany(
    { _id: { $in: categoryDocs.map((c) => c._id) } },
    { $set: { is_locked: true, assigned_seller_id: coupon.createdBy, lockedAt: new Date() } }
  );
}

/**
 * Recompute queue positions for all queued coupons.
 * Queue position = 1-based index in the ordered queue (oldest approvedAt/createdAt first).
 */
async function recomputeQueuePositions(): Promise<void> {
  const queuedCoupons = await Coupon.find({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "queued",
  }).sort({ approvedAt: 1, createdAt: 1 });

  for (let i = 0; i < queuedCoupons.length; i++) {
    if (queuedCoupons[i].queuePosition !== i + 1) {
      queuedCoupons[i].queuePosition = i + 1;
      await queuedCoupons[i].save();
    }
  }
}

/**
 * Homepage Coupon Queue Engine:
 * - Expires running coupons whose expiresAt has passed
 * - Promotes the oldest queued coupon into each freed running slot
 * - Fallback: if no queued coupon exists, keeps the expired coupon visible ("running")
 *   until a replacement arrives
 * - Updates queuePosition for all queued coupons
 */
async function runHomepageQueueEngine(): Promise<void> {
  const now = new Date();
  
  // Get all currently running coupons
  const runningCoupons = await Coupon.find({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "running",
  });

  // Find expired runners
  const expiredRunners = runningCoupons.filter((c) => c.expiresAt && c.expiresAt <= now);

  // Process each expired runner
  for (const expired of expiredRunners) {
    // Find the oldest queued coupon
    const nextQueued = await Coupon.findOne({
      placement: "homepage",
      approvalStatus: "approved",
      homepageStatus: "queued",
    }).sort({ approvedAt: 1, createdAt: 1 });

    if (!nextQueued) {
      // Fallback: keep the expired coupon visible until a replacement arrives
      expired.homepageStatus = "expired";
      expired.isActive = false;
      await expired.save();
      continue;
    }

    // Promote the queued coupon to running
    const durationDays = nextQueued.durationDays ?? 7;
    const startsAt = nextQueued.promoStartDate && nextQueued.promoStartDate > now 
      ? nextQueued.promoStartDate 
      : now;
    
    nextQueued.startsAt = startsAt;
    nextQueued.expiresAt = new Date(startsAt.getTime() + durationDays * DAY_MS);
    nextQueued.homepageStatus = "running";
    nextQueued.queuePosition = undefined;
    nextQueued.isActive = true;
    await nextQueued.save();

    // Mark the expired coupon as expired (fallback visibility)
    expired.homepageStatus = "expired";
    expired.isActive = false;
    await expired.save();
  }

  // Recompute queue positions for all remaining queued coupons
  await recomputeQueuePositions();
}

/** GET /coupons - sellers see their own coupons, admins see every coupon on the platform. */
export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const { placement, approvalStatus } = req.query as { placement?: string; approvalStatus?: string };

  const filter: FilterQuery<ICoupon> = req.user!.role === "admin" ? {} : { createdBy: req.user!.id };
  if (placement) filter.placement = placement;
  if (approvalStatus) filter.approvalStatus = approvalStatus;

  const coupons = await Coupon.find(filter).sort({ createdAt: -1 });
  res.status(200).json(coupons);
});

/**
 * POST /coupons - creates a coupon.
 *  - Admins: always auto-approved and live immediately (site-wide platform coupons).
 *  - Sellers, placement "store"/"private": auto-approved and live immediately.
 *  - Sellers, placement "homepage": goes in as "pending" and inactive until an
 *    admin approves it (see approveCoupon below).
 */
export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const exists = await Coupon.findOne({ code: req.body.code });
  if (exists) throw ApiError.conflict("Coupon code already exists");

  const role = req.user!.role as "seller" | "admin";

  if (role === "seller") {
    await assertCategoryLimitNotExceeded(req.body);
    await assertCategoriesNotLockedToOtherSeller(req.body, req.user!.id);
  }

  const isHomepageRequest = role === "seller" && req.body.placement === "homepage";

  const coupon = await Coupon.create({
    ...req.body,
    createdBy: req.user!.id,
    createdByRole: role,
    approvalStatus: isHomepageRequest ? "pending" : "approved",
    isActive: !isHomepageRequest,
    approvedAt: isHomepageRequest ? undefined : new Date(),
  });

  sendSuccess(res, coupon.toJSON(), isHomepageRequest ? "Homepage request sent to admin" : "Coupon created", 201);
});

/**
 * PATCH /coupons/:id/approve - admin only. Approves a pending homepage request.
 *  - "specific-category" coupons lock their category/categories to the seller
 *    (subject to the admin's global category_length limit).
 *  - Queue Engine: goes "running" (live, 1 of 3 slots) if a slot is free,
 *    otherwise "queued" until a running coupon expires.
 */
export const approveCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (coupon.placement !== "homepage") throw ApiError.badRequest("Only homepage requests need approval");

  // Allow admin to override duration/launch date
  if (req.body.durationDays) coupon.durationDays = req.body.durationDays;
  if (req.body.promoStartDate) coupon.promoStartDate = new Date(req.body.promoStartDate);

  await lockCategoriesForSeller(coupon);
  await runHomepageQueueEngine();

  const now = new Date();
  const durationDays = coupon.durationDays ?? 7;
  const runningCount = await Coupon.countDocuments({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "running",
  });

  coupon.approvalStatus = "approved";
  coupon.rejectionNote = undefined;
  coupon.approvedAt = now;

  if (runningCount < HOMEPAGE_RUNNING_SLOTS) {
    const startsAt = coupon.promoStartDate && coupon.promoStartDate > now ? coupon.promoStartDate : now;
    coupon.startsAt = startsAt;
    coupon.expiresAt = new Date(startsAt.getTime() + durationDays * DAY_MS);
    coupon.homepageStatus = "running";
    coupon.queuePosition = undefined;
    coupon.isActive = true;
  } else {
    // Get current queue length to assign position
    const queuedCount = await Coupon.countDocuments({
      placement: "homepage",
      approvalStatus: "approved",
      homepageStatus: "queued",
    });
    coupon.startsAt = undefined;
    coupon.expiresAt = undefined;
    coupon.homepageStatus = "queued";
    coupon.queuePosition = queuedCount + 1;
    coupon.isActive = false;
  }

  await coupon.save();

  // Notify the seller about approval
  await createNotification({
    userId: coupon.createdBy,
    recipientType: "seller",
    type: "coupon",
    category: "system",
    priority: "info",
    source: "admin",
    title: "Homepage Coupon Approved",
    message: coupon.homepageStatus === "running"
      ? `Your coupon "${coupon.code}" has been approved and is now live on the homepage.`
      : `Your coupon "${coupon.code}" has been approved and queued — it will go live once a running slot frees up.`,
    link: "/dashboard/seller/coupons",
  });

  sendSuccess(
    res,
    coupon.toJSON(),
    coupon.homepageStatus === "running"
      ? "Coupon approved and published to the homepage"
      : "Coupon approved and queued — it will go live once a running slot frees up"
  );
});

/** GET /coupons/homepage-queue - admin only. Snapshot of running vs queued homepage coupons. */
export const getHomepageQueueStatus = asyncHandler(async (_req: Request, res: Response) => {
  await runHomepageQueueEngine();
  const [running, queued] = await Promise.all([
    Coupon.find({ placement: "homepage", approvalStatus: "approved", homepageStatus: "running" }).sort({
      startsAt: 1,
    }),
    Coupon.find({ placement: "homepage", approvalStatus: "approved", homepageStatus: "queued" }).sort({
      approvedAt: 1,
      createdAt: 1,
    }),
  ]);
  
  // Add queue position to running coupons based on their order
  const runningWithPosition = running.map((c, i) => ({
    ...c.toJSON(),
    queuePosition: i + 1,
  }));
  
  sendSuccess(res, { running: runningWithPosition, queued });
});

/** PATCH /coupons/:id/reject - admin only. Rejects a pending homepage request with optional report. */
export const rejectCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (coupon.placement !== "homepage") throw ApiError.badRequest("Only homepage requests can be rejected");

  coupon.approvalStatus = "rejected";
  coupon.isActive = false;
  coupon.rejectionNote = req.body?.rejectionNote;
  await coupon.save();

  const reportMsg = coupon.rejectionNote
    ? `Your coupon "${coupon.code}" has been rejected. Admin report: ${coupon.rejectionNote}`
    : `Your coupon "${coupon.code}" has been rejected by an admin.`;

  await createNotification({
    userId: coupon.createdBy,
    recipientType: "seller",
    type: "coupon",
    category: "system",
    priority: "warning",
    source: "admin",
    title: "Homepage Coupon Rejected",
    message: reportMsg,
    link: "/dashboard/seller/coupons",
  });

  sendSuccess(res, coupon.toJSON(), "Coupon rejected");
});

/** PATCH /coupons/:id/report - admin only. Sends a report/notification to the seller and marks coupon as reported. */
export const reportCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");

  const reportNote = req.body?.rejectionNote || req.body?.reportNote;
  if (!reportNote || !reportNote.trim()) {
    throw ApiError.badRequest("Report note is required");
  }

  coupon.approvalStatus = "reported";
  coupon.isActive = false;
  coupon.rejectionNote = reportNote.trim();
  await coupon.save();

  await createNotification({
    userId: coupon.createdBy,
    recipientType: "seller",
    type: "coupon",
    category: "system",
    priority: "warning",
    source: "admin",
    title: "Admin Report on Coupon",
    message: `Admin report for your coupon "${coupon.code}": ${coupon.rejectionNote}`,
    link: "/dashboard/seller/coupons",
  });

  sendSuccess(res, coupon.toJSON(), "Coupon reported and disabled");
});

export const deleteCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (req.user!.role !== "admin" && coupon.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this coupon");
  }
  await coupon.deleteOne();
  sendSuccess(res, { success: true }, "Coupon deleted");
});

/** PUT /coupons/:id - seller/admin can update their own coupon (admin can update any of their own site-wide coupons). */
export const updateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");

  // Admin cannot edit seller coupons — they can only change status (approve/reject/report)
  if (req.user!.role === "admin" && coupon.createdByRole === "seller") {
    throw ApiError.forbidden("Admins cannot edit seller coupon details. Use approve, reject, or report to change status.");
  }

  if (req.user!.role !== "admin" && coupon.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this coupon");
  }

  // If code changed, check uniqueness
  if (req.body.code && req.body.code !== coupon.code) {
    const exists = await Coupon.findOne({ code: req.body.code });
    if (exists) throw ApiError.conflict("Coupon code already exists");
  }

  if (req.user!.role === "seller") {
    await assertCategoryLimitNotExceeded({
      scope: req.body.scope ?? coupon.scope,
      placement: req.body.placement ?? coupon.placement,
      category: req.body.category,
      categories: req.body.categories,
    });
    if (req.body.category || req.body.categories) {
      await assertCategoriesNotLockedToOtherSeller(
        { scope: req.body.scope ?? coupon.scope, category: req.body.category, categories: req.body.categories },
        req.user!.id
      );
    }
  }

  const updatable = [
    "code", "type", "value", "minPurchase", "maxDiscount",
    "scope", "category", "categories", "productIds",
    "placement", "usageLimit", "startsAt", "expiresAt",
    "promoStartDate", "durationDays",
  ];
  for (const key of updatable) {
    if (req.body[key] !== undefined) {
      (coupon as any)[key] = req.body[key];
    }
  }

  // Re-evaluate approval if placement changed to homepage for seller
  if (req.user!.role === "seller" && coupon.placement === "homepage") {
    coupon.approvalStatus = "pending";
    coupon.isActive = false;
  }

  await coupon.save();
  sendSuccess(res, coupon.toJSON(), "Coupon updated");
});

export const validateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const subtotal = Number(req.query.subtotal ?? 0);

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) throw ApiError.notFound("Invalid coupon code");

  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");

  sendSuccess(res, { code: coupon.code, discount, type: coupon.type, value: coupon.value });
});

/**
 * GET /coupons/public/homepage (aliased at GET /homepage-coupons) - Queue Engine
 * output: always returns up to 3 currently-"running" homepage coupons. Advances
 * the queue first (expires finished runners, promotes the oldest queued coupon,
 * falls back to keeping an expired runner visible if nothing is queued).
 */
export const getPublicHomepageCoupons = asyncHandler(async (_req: Request, res: Response) => {
  await runHomepageQueueEngine();

  const coupons = await Coupon.find({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "running",
  })
    .sort({ startsAt: 1 })
    .limit(HOMEPAGE_RUNNING_SLOTS);

  res.status(200).json(coupons);
});

/** GET /coupons/category-limit - returns the platform category limit set by admin. */
export const getCategoryLimit = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  sendSuccess(res, { category_length: settings.category_length });
});

/** GET /coupons/public/store/:sellerId - approved, currently-live coupons for one seller's public store page. */
export const getPublicStoreCoupons = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const coupons = await Coupon.find({
    placement: "store",
    createdBy: req.params.sellerId,
    approvalStatus: "approved",
    isActive: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).sort({ createdAt: -1 });

  res.status(200).json(coupons);
});
