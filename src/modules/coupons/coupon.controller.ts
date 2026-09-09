import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { Coupon, ICoupon, computeDiscount, isFreeShippingCouponApplicable, CartLineItem } from "./coupon.model";
import { Store } from "../sellers/store.model";
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
 * (homepage placement only) for a category already locked/assigned to a different seller.
 */
async function assertCategoriesNotLockedToOtherSeller(
  body: { scope?: string; placement?: string; categories?: string[]; category?: string },
  sellerId: string
) {
  if (body.placement !== "homepage") return;
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
 * than the admin-configured category_length limit for homepage coupons.
 * This is a PER-SELLER limit: each seller can use up to `category_length` categories
 * for their homepage coupons.
 */
async function assertCategoryLimitNotExceeded(
  body: { scope?: string; placement?: string; categories?: string[]; category?: string },
  sellerId: string
) {
  if (body.placement !== "homepage") return;
  if (body.scope !== "specific-category") return;
  const catNames = resolveCategoryNames(body);
  if (catNames.length === 0) return;

  const settings = await getSettingsSingleton();
  
  // Count categories already locked to this seller for homepage coupons
  const sellerLockedCount = await Category.countDocuments({
    is_locked: true,
    assigned_seller_id: sellerId,
  });

  // Total categories this seller would have after adding new ones
  // We need to avoid double-counting categories that are already in the seller's locked categories
  const alreadyLockedCategories = await Category.find({
    is_locked: true,
    assigned_seller_id: sellerId,
    name: { $in: catNames },
  }).select("name");
  
  const alreadyLockedNames = new Set(alreadyLockedCategories.map(c => c.name));
  const newCategoriesCount = catNames.filter(name => !alreadyLockedNames.has(name)).length;
  
  if (sellerLockedCount + newCategoriesCount > settings.category_length) {
    throw ApiError.badRequest(
      `You cannot select ${catNames.length} categories for homepage coupons. You already have ${sellerLockedCount} categories allocated, and this would exceed the per-seller limit of ${settings.category_length}.`
    );
  }
}

/**
 * Approval-time Category Allocation & Lock: locks every category on a
 * "specific-category" coupon to its seller, enforcing the admin's per-seller
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
    // Count categories already locked to THIS seller (per-seller limit)
    const sellerLockedCount = await Category.countDocuments({
      is_locked: true,
      assigned_seller_id: coupon.createdBy,
    });
    if (sellerLockedCount + toLock.length > settings.category_length) {
      throw ApiError.badRequest(
        `Approving this request would lock ${toLock.length} more categor${toLock.length === 1 ? "y" : "ies"} for this seller, exceeding the per-seller limit of ${settings.category_length}.`
      );
    }
  }

  await Category.updateMany(
    { _id: { $in: categoryDocs.map((c) => c._id) } },
    { $set: { is_locked: true, assigned_seller_id: coupon.createdBy, lockedAt: new Date() } }
  );
}

/**
 * Release category locks for a coupon if no other valid homepage coupon
 * from the same seller is using those categories.
 * Valid coupons: placement=homepage, approvalStatus=approved, homepageStatus=running|queued
 */
async function releaseCategoriesIfUnused(coupon: ICoupon): Promise<void> {
  if (coupon.scope !== "specific-category") return;
  const catNames = resolveCategoryNames(coupon);
  if (catNames.length === 0) return;

  for (const catName of catNames) {
    const otherCoupon = await Coupon.findOne({
      placement: "homepage",
      approvalStatus: "approved",
      homepageStatus: { $in: ["running", "queued"] },
      scope: "specific-category",
      createdBy: coupon.createdBy,
      _id: { $ne: coupon._id },
      $or: [{ category: catName }, { categories: catName }],
    });

    if (!otherCoupon) {
      await Category.updateOne(
        { name: catName, assigned_seller_id: coupon.createdBy },
        { $set: { is_locked: false, assigned_seller_id: null, lockedAt: null } }
      );
    }
  }
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
 * - Expires running coupons whose expiresAt has passed, or whose usage limit is exhausted
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

  // Find expired runners (past their expiresAt, or their usage limit is exhausted)
  const expiredRunners = runningCoupons.filter(
    (c) =>
      (c.expiresAt && c.expiresAt <= now) ||
      (c.usageLimit != null && c.usedCount >= c.usageLimit)
  );

  // Process each expired/exhausted runner
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
      // Release category locks since coupon is no longer valid
      await releaseCategoriesIfUnused(expired);
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
    // Release category locks since coupon is no longer valid
    await releaseCategoriesIfUnused(expired);
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
    await assertCategoryLimitNotExceeded(req.body, req.user!.id);
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

  // 1. First, update the coupon to approved status and save it
  const now = new Date();
  coupon.approvalStatus = "approved";
  coupon.rejectionNote = undefined;
  coupon.approvedAt = now;
  await coupon.save();

  // 2. Run the homepage queue engine (now sees the newly approved coupon)
  await runHomepageQueueEngine();

  // 3. Count running coupons AFTER queue engine has processed expirations
  const durationDays = coupon.durationDays ?? 7;
  const runningCount = await Coupon.countDocuments({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "running",
  });

  // 4. Determine if the new coupon should be running or queued
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

  // Release category locks since coupon is no longer valid
  await releaseCategoriesIfUnused(coupon);

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

/**
 * PATCH /coupons/:id/resolve-report - admin only. Clears an admin report on a
 * reported coupon, restoring it to approved/active and removing the report note.
 * The seller is notified that the report has been resolved.
 */
export const resolveReportCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (coupon.approvalStatus !== "reported") {
    throw ApiError.badRequest("Only reported coupons can have their report resolved");
  }

  // Re-acquire category locks for homepage specific-category coupons
  if (coupon.placement === "homepage" && coupon.scope === "specific-category") {
    await lockCategoriesForSeller(coupon);
  }

  coupon.approvalStatus = "approved";
  coupon.isActive = true;
  coupon.rejectionNote = undefined;
  await coupon.save();

  // Run queue engine to place the coupon in running or queued
  await runHomepageQueueEngine();

  await createNotification({
    userId: coupon.createdBy,
    recipientType: "seller",
    type: "coupon",
    category: "system",
    priority: "info",
    source: "admin",
    title: "Admin Report Resolved",
    message: `The report on your coupon "${coupon.code}" has been resolved by an admin. The coupon has been restored and is now active again.`,
    link: "/dashboard/seller/coupons",
  });

  sendSuccess(res, coupon.toJSON(), "Coupon report resolved");
});

export const deleteCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (req.user!.role !== "admin" && coupon.createdBy !== req.user!.id) {
    throw ApiError.forbidden("You do not own this coupon");
  }

  // Release category locks if no other valid homepage coupon from the same seller uses them
  await releaseCategoriesIfUnused(coupon);

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

  // Capture pre-update state for category lock synchronization
  const wasApprovedHomepageSpecificCategory =
    coupon.placement === "homepage" &&
    coupon.approvalStatus === "approved" &&
    coupon.scope === "specific-category";
  const oldCategories = wasApprovedHomepageSpecificCategory ? resolveCategoryNames(coupon) : [];

  if (req.user!.role === "seller") {
    await assertCategoryLimitNotExceeded({
      scope: req.body.scope ?? coupon.scope,
      placement: req.body.placement,
      category: req.body.category,
      categories: req.body.categories,
    }, req.user!.id);
    if (req.body.category || req.body.categories) {
      await assertCategoriesNotLockedToOtherSeller(
        { scope: req.body.scope ?? coupon.scope, category: req.body.category, categories: req.body.categories, placement: req.body.placement },
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

  // Synchronize category locks after update
  const isNowApprovedHomepageSpecificCategory =
    coupon.placement === "homepage" &&
    coupon.approvalStatus === "approved" &&
    coupon.scope === "specific-category";
  const newCategories = isNowApprovedHomepageSpecificCategory ? resolveCategoryNames(coupon) : [];

  if (wasApprovedHomepageSpecificCategory || isNowApprovedHomepageSpecificCategory) {
    const removedCategories = oldCategories.filter((c) => !newCategories.includes(c));
    const addedCategories = newCategories.filter((c) => !oldCategories.includes(c));

    // Release locks for removed categories if no other valid coupon uses them
    for (const catName of removedCategories) {
      const otherCoupon = await Coupon.findOne({
        placement: "homepage",
        approvalStatus: "approved",
        homepageStatus: { $in: ["running", "queued"] },
        scope: "specific-category",
        createdBy: coupon.createdBy,
        _id: { $ne: coupon._id },
        $or: [{ category: catName }, { categories: catName }],
      });
      if (!otherCoupon) {
        await Category.updateOne(
          { name: catName, assigned_seller_id: coupon.createdBy },
          { $set: { is_locked: false, assigned_seller_id: null, lockedAt: null } }
        );
      }
    }

    // Lock newly added categories (for admin edits where coupon stays approved)
    if (addedCategories.length > 0 && isNowApprovedHomepageSpecificCategory) {
      // Validate conflicts with other sellers
      const conflict = await Category.findOne({
        name: { $in: addedCategories },
        is_locked: true,
        assigned_seller_id: { $ne: coupon.createdBy },
      });
      if (conflict) {
        throw ApiError.conflict(`Category "${conflict.name}" is already locked to another seller`);
      }

      // For sellers, category limit is checked on next approval (coupon goes to pending)
      // For admins editing their own approved coupon, check limit now
      if (req.user!.role === "admin" && coupon.createdByRole === "admin") {
        const settings = await getSettingsSingleton();
        const sellerLockedCount = await Category.countDocuments({
          is_locked: true,
          assigned_seller_id: coupon.createdBy,
        });
        const alreadyLockedNames = new Set(
          (await Category.find({ is_locked: true, assigned_seller_id: coupon.createdBy, name: { $in: addedCategories } }).select("name")).map((c) => c.name)
        );
        const newCategoriesCount = addedCategories.filter((name) => !alreadyLockedNames.has(name)).length;
        if (sellerLockedCount + newCategoriesCount > settings.category_length) {
          throw ApiError.badRequest(
            `Approving this change would lock ${newCategoriesCount} more categor${newCategoriesCount === 1 ? "y" : "ies"} for this seller, exceeding the per-seller limit of ${settings.category_length}.`
          );
        }
      }

      await Category.updateMany(
        { name: { $in: addedCategories } },
        { $set: { is_locked: true, assigned_seller_id: coupon.createdBy, lockedAt: new Date() } }
      );
    }

    // If coupon was approved homepage specific-category but no longer is (e.g., seller edit -> pending),
    // release all old categories that weren't retained (already handled by removedCategories above)
    // Note: retained categories keep their locks automatically
  }

  sendSuccess(res, coupon.toJSON(), "Coupon updated");
});

export const validateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const { items } = req.body as { items: CartLineItem[] };

  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon) throw ApiError.notFound("Invalid coupon code");

  // free-shipping coupons don't reduce the product subtotal — they waive the
  // delivery fee, so they're validated through the shipping-applicability path
  // rather than computeDiscount (which returns 0 for this type).
  if (coupon.type === "free-shipping") {
    if (!isFreeShippingCouponApplicable(coupon, items)) {
      throw ApiError.badRequest("Coupon is not applicable to this order");
    }
    sendSuccess(res, {
      code: coupon.code,
      discount: 0,
      type: coupon.type,
      value: coupon.value,
      freeShipping: true,
    });
    return;
  }

  const discount = computeDiscount(coupon, items);
  if (discount <= 0) throw ApiError.badRequest("Coupon is not applicable to this order");

  sendSuccess(res, { code: coupon.code, discount, type: coupon.type, value: coupon.value, freeShipping: false });
});

/**
 * GET /coupons/public/homepage (aliased at GET /homepage-coupons) - Queue Engine
 * output: returns up to 3 homepage coupons. Advances the queue first (expires
 * finished/exhausted runners, promotes the oldest queued coupon, falls back to
 * keeping an expired runner visible if nothing is queued).
 *
 * The result is "running" coupons first, topped up with "expired" fallback
 * coupons (per the model's fallback-visibility contract) only to fill any
 * empty slots left after promotion — so a slot that already has a running
 * coupon never also shows its stale fallback. Each coupon is enriched with
 * its seller's storeName/logo for display.
 */
export const getPublicHomepageCoupons = asyncHandler(async (_req: Request, res: Response) => {
  await runHomepageQueueEngine();

  const running = await Coupon.find({
    placement: "homepage",
    approvalStatus: "approved",
    homepageStatus: "running",
  }).sort({ startsAt: 1 });

  let coupons = running;
  const remainingSlots = HOMEPAGE_RUNNING_SLOTS - running.length;
  if (remainingSlots > 0) {
    const fallbackExpired = await Coupon.find({
      placement: "homepage",
      approvalStatus: "approved",
      homepageStatus: "expired",
    })
      .sort({ expiresAt: -1 })
      .limit(remainingSlots);
    coupons = [...running, ...fallbackExpired];
  }
  coupons = coupons.slice(0, HOMEPAGE_RUNNING_SLOTS);

  // Batch-fetch each coupon's seller Store so we can attach storeName/logo
  // without an N+1 query per coupon.
  const sellerIds = [...new Set(coupons.map((c) => c.createdBy))];
  const stores = sellerIds.length > 0 ? await Store.find({ ownerId: { $in: sellerIds } }) : [];
  const storeByOwnerId = new Map(stores.map((s) => [s.ownerId, s]));

  const enriched = coupons.map((coupon) => {
    const store = storeByOwnerId.get(coupon.createdBy);
    return {
      ...coupon.toJSON(),
      storeName: store?.storeName,
      logo: store?.logo,
    };
  });

  res.status(200).json(enriched);
});

/** GET /coupons/category-limit - returns the platform category limit set by admin. */
export const getCategoryLimit = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  sendSuccess(res, { category_length: settings.category_length });
});

/** GET /coupons/seller-locked-categories/:sellerId - returns categories locked to a specific seller. */
export const getSellerLockedCategories = asyncHandler(async (req: Request, res: Response) => {
  let sellerId = req.params.sellerId;
  if (!sellerId || sellerId === "me") {
    sellerId = req.user!.id;
  }
  // Only allow sellers to see their own, admins can see any
  if (req.user!.role !== "admin" && sellerId !== req.user!.id) {
    throw ApiError.forbidden("You can only view your own locked categories");
  }
  
  const lockedCategories = await Category.find({
    is_locked: true,
    assigned_seller_id: sellerId,
  }).select("name");
  
  sendSuccess(res, lockedCategories.map(c => c.name));
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
