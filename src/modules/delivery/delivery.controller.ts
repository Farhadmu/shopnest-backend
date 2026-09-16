import { Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { DeliveryManProfile, DeliveryManDetails } from "./delivery-man.model";
import { DeliveryRequest, DeliveryRequestStatus } from "./delivery-request.model";
import { DeliveryLocation } from "./delivery-location.model";
import { DeliveryRating } from "./delivery-rating.model";
import { DeliveryIncident } from "./delivery-incident.model";
import { Order } from "../orders/order.model";
import { createNotification } from "../notifications/notification.service";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendPaginated } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { normalizeLean, normalizeLeanArray } from "../../utils/model-plugins";
import { emitDeliveryEvent, emitAdminOperationsEvent } from "../../realtime/socket.server";
import { getApproxCoordinatesFromAddress, calculateDistanceMeters, isValidCoordinate } from "../../utils/geo";

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/** Get authenticated delivery man's profile and details */
export const getDeliveryManProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const profile = await DeliveryManProfile.findOne({ userId }).lean();
  const details = await DeliveryManDetails.findOne({ userId }).lean();

  if (!profile) {
    sendSuccess(res, { profile: null, details: null });
    return;
  }

  sendSuccess(res, {
    profile: normalizeLean(profile as unknown as Record<string, unknown>),
    details: details ? normalizeLean(details as unknown as Record<string, unknown>) : null,
  });
});

/** Create or update delivery man profile (Registration Form / Updates) */
export const createOrUpdateDeliveryManProfile = asyncHandler(async (req: Request, res: Response) => {
  const {
    personal,
    identity,
    license,
    vehicle,
    bank,
    preferences,
  } = req.body as {
    personal?: Record<string, unknown>;
    identity?: Record<string, unknown>;
    license?: Record<string, unknown>;
    vehicle?: Record<string, unknown>;
    bank?: Record<string, unknown>;
    preferences?: Record<string, unknown>;
  };

  const userId = req.user!.id;

  let profile = await DeliveryManProfile.findOne({ userId });
  if (!profile) {
    profile = await DeliveryManProfile.create({
      userId,
      status: "pending_verification",
    });
  } else if (profile.status === "rejected" || profile.resubmissionRequired) {
    profile.status = "pending_verification";
    profile.resubmissionRequired = false;
    await profile.save();
  }

  const update: Record<string, unknown> = {};
  if (personal) update.personal = personal;
  if (identity) update.identity = identity;
  if (license) update.license = license;
  if (vehicle) update.vehicle = vehicle;
  if (bank) update.bank = bank;
  if (preferences) update.preferences = preferences;

  // Derive default capacity based on vehicle type if not explicitly set
  if (vehicle && (vehicle as any).vehicleType) {
    const vType = (vehicle as any).vehicleType;
    const defaultCapacity = vType === "van" ? 10 : vType === "car" ? 5 : vType === "motorcycle" ? 3 : 1;
    if (!update["vehicle.vehicleCapacity"] && !(vehicle as any).vehicleCapacity) {
      if (!update.vehicle) update.vehicle = {};
      (update.vehicle as any).vehicleCapacity = defaultCapacity;
    }
  }

  const details = await DeliveryManDetails.findOneAndUpdate(
    { userId },
    { $set: update },
    { upsert: true, new: true, runValidators: true, lean: true }
  );

  const updatedProfile = await DeliveryManProfile.findOne({ userId }).lean();

  sendSuccess(
    res,
    {
      profile: updatedProfile ? normalizeLean(updatedProfile as unknown as Record<string, unknown>) : null,
      details: details ? normalizeLean(details as unknown as Record<string, unknown>) : null,
    },
    "Application profile updated successfully"
  );
});

/** Upload verification document (NID, License, Vehicle Doc, Photo) */
export const uploadDeliveryDocument = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest("No file uploaded");
  }

  const relativeUrl = `/uploads/delivery/${file.filename}`;
  sendSuccess(res, { url: relativeUrl, filename: file.filename }, "Document uploaded successfully", 201);
});

/** Set delivery partner availability (offline / available / busy / full_capacity / on_break / suspended) */
export const setAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { availabilityStatus, isActive } = req.body as {
    availabilityStatus?: "offline" | "available" | "busy" | "full_capacity" | "on_break" | "suspended";
    isActive?: boolean;
  };

  const userId = req.user!.id;
  const profile = await DeliveryManProfile.findOne({ userId });
  if (profile?.status === "suspended") {
    throw ApiError.forbidden("Your delivery account has been suspended by administration.");
  }

  const activeCount = await DeliveryRequest.countDocuments({
    assignedDeliveryManId: userId,
    status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
  });

  const existingDetails = await DeliveryManDetails.findOne({ userId }).lean();
  const maxActive = existingDetails?.preferences?.maxActiveDeliveries ?? existingDetails?.vehicle?.vehicleCapacity ?? 3;

  let effectiveStatus = availabilityStatus;
  if (availabilityStatus === "available") {
    if (activeCount >= maxActive) {
      effectiveStatus = "full_capacity";
    } else if (activeCount > 0) {
      effectiveStatus = "busy";
    }
  }

  const update: Record<string, unknown> = {};
  if (effectiveStatus) update.availabilityStatus = effectiveStatus;
  if (isActive !== undefined) update.isActive = isActive;
  if (effectiveStatus === "available" || effectiveStatus === "busy" || effectiveStatus === "full_capacity") {
    update.isActive = true;
  }
  if (effectiveStatus === "offline") {
    update.isActive = false;
  }
  update.lastActiveAt = new Date();

  const details = await DeliveryManDetails.findOneAndUpdate(
    { userId },
    { $set: update, $setOnInsert: { userId, availabilityStatus: "offline" } },
    { upsert: true, new: true, runValidators: true, lean: true }
  );

  sendSuccess(
    res,
    {
      availabilityStatus: details?.availabilityStatus,
      isActive: details?.isActive,
      activeDeliveries: activeCount,
      maxCapacity: maxActive,
    },
    "Availability updated"
  );
});

/** Update real-time GPS location */
export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const {
    latitude,
    longitude,
    accuracy,
    altitude,
    speed,
    heading,
    deliveryRequestId,
  } = req.body as {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    deliveryRequestId?: string;
  };

  const userId = req.user!.id;
  const now = new Date();

  await DeliveryManDetails.findOneAndUpdate(
    { userId },
    {
      $set: {
        isActive: true,
        lastActiveAt: now,
        "currentLocation.latitude": latitude,
        "currentLocation.longitude": longitude,
        "currentLocation.speed": speed,
        "currentLocation.heading": heading,
        "currentLocation.accuracy": accuracy,
        "currentLocation.updatedAt": now,
      },
    },
    { upsert: true }
  );

  // If there's an active delivery associated, log the location breadcrumb
  if (deliveryRequestId) {
    const activeReq = await DeliveryRequest.findOne({
      _id: deliveryRequestId,
      assignedDeliveryManId: userId,
      status: { $in: ["picked_up", "in_transit", "out_for_delivery"] },
    });
    if (activeReq) {
      await DeliveryLocation.create({
        deliveryRequestId,
        deliveryManId: userId,
        latitude,
        longitude,
        accuracy,
        altitude,
        speed,
        heading,
        recordedAt: now,
      });
    }
  }

  sendSuccess(res, { latitude, longitude, accuracy, speed, updatedAt: now }, "Location updated");
});

/** GET /delivery/requests/available - Pathao-style Open Marketplace with Smart Ranking */
export const getAvailableDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const { page = "1", limit = "20", zone } = req.query as {
    page?: string;
    limit?: string;
    zone?: string;
  };

  const deliveryMan = await DeliveryManProfile.findOne({ userId: req.user!.id });
  if (!deliveryMan || deliveryMan.status !== "approved") {
    throw ApiError.forbidden("Delivery partner profile is not approved");
  }

  const details = await DeliveryManDetails.findOne({ userId: req.user!.id }).lean();
  const maxActive = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;

  const activeDeliveries = await DeliveryRequest.find({
    assignedDeliveryManId: req.user!.id,
    status: {
      $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"],
    },
  }).lean();

  const activeCount = activeDeliveries.length;
  const remainingSlots = Math.max(0, maxActive - activeCount);

  if (activeCount >= maxActive) {
    sendPaginated(res, [], 0, Number(page), Number(limit));
    return;
  }

  const vType = details?.vehicle?.vehicleType || "motorcycle";
  const maxCapacityWeight = details?.vehicle?.vehicleCapacity
    ? details.vehicle.vehicleCapacity * 5
    : vType === "van"
    ? 50
    : vType === "car"
    ? 30
    : vType === "motorcycle"
    ? 20
    : vType === "bicycle"
    ? 10
    : 15;

  const currentLoadedWeight = activeDeliveries.reduce((sum, d) => sum + (d.packageInfo?.weight || 0), 0);
  const remainingWeightKg = Math.max(0, maxCapacityWeight - currentLoadedWeight);

  const filter: Record<string, unknown> = {
    status: "available",
  };

  if (zone) {
    filter.pickupAddress = new RegExp(zone, "i");
  }

  const preferredZones = details?.personal?.serviceArea || details?.preferences?.preferredServiceZones;
  if (preferredZones && preferredZones.length > 0 && !zone) {
    const zoneRegexes = preferredZones.map((z) => new RegExp(z, "i"));
    filter.$or = [
      { pickupAddress: { $in: zoneRegexes } },
      { deliveryAddress: { $in: zoneRegexes } },
    ];
  }

  let [deliveries, total] = await Promise.all([
    DeliveryRequest.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .lean(),
    DeliveryRequest.countDocuments(filter),
  ]);

  if (deliveries.length === 0 && filter.$or) {
    delete filter.$or;
    [deliveries, total] = await Promise.all([
      DeliveryRequest.find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .lean(),
      DeliveryRequest.countDocuments(filter),
    ]);
  }

  const riderLat = details?.currentLocation?.latitude;
  const riderLng = details?.currentLocation?.longitude;
  const hasRiderGps = riderLat !== undefined && riderLng !== undefined && riderLat !== null && riderLng !== null && isValidCoordinate(riderLat, riderLng);

  // Enrich each delivery with real calculations, ranking, facts & inferences
  const enrichedDeliveries = deliveries.map((d) => {
    const pCoords = getApproxCoordinatesFromAddress(d.pickupAddress);
    const dCoords = getApproxCoordinatesFromAddress(d.deliveryAddress);
    const pkgWeight = d.packageInfo?.weight || 0;

    let pickupDistanceKm: number | null = null;
    let estimatedTravelMinutes: number | null = null;

    if (hasRiderGps && pCoords?.latitude && pCoords?.longitude) {
      const distMeters = calculateDistanceMeters(riderLat!, riderLng!, pCoords.latitude, pCoords.longitude);
      pickupDistanceKm = Math.round((distMeters / 1000) * 10) / 10;
      // Realistic city traffic speed: ~25 km/h + 5 min pickup buffer
      estimatedTravelMinutes = Math.max(5, Math.round((pickupDistanceKm / 25) * 60) + 5);
    }

    const fitsWeight = pkgWeight === 0 || pkgWeight <= remainingWeightKg;
    const fitsCapacity = remainingSlots > 0 && fitsWeight;

    // Route overlap check with active deliveries
    let routeCompatibility: "High" | "Medium" | "Standard" = "Standard";
    if (activeDeliveries.length > 0 && pCoords) {
      for (const ad of activeDeliveries) {
        const adDrop = getApproxCoordinatesFromAddress(ad.deliveryAddress);
        if (adDrop) {
          const proximity = calculateDistanceMeters(pCoords.latitude, pCoords.longitude, adDrop.latitude, adDrop.longitude);
          if (proximity <= 2000) {
            routeCompatibility = "High";
            break;
          } else if (proximity <= 5000) {
            routeCompatibility = "Medium";
          }
        }
      }
    }

    const norm = normalizeLean(d as unknown as Record<string, unknown>);

    return {
      ...norm,
      pickupCoordinates: pCoords,
      deliveryCoordinates: dCoords,
      ranking: {
        pickupDistanceKm,
        estimatedTravelMinutes,
        fitsCapacity,
        fitsWeight,
        routeCompatibility,
        remainingSlots,
        remainingWeightKg,
      },
      facts: {
        orderId: d.orderId,
        pickupAddress: d.pickupAddress,
        deliveryAddress: d.deliveryAddress,
        deliveryFee: d.deliveryFee || 60,
        packageWeightKg: pkgWeight,
        fragile: d.packageInfo?.fragile || false,
        priority: d.priority,
      },
      calculations: {
        pickupDistanceKm,
        estimatedTravelMinutes,
        remainingSlots,
        remainingWeightKg,
        maxVehicleCapacity: maxActive,
      },
      inferences: {
        fitsCapacity,
        routeCompatibility,
        recommendationReason:
          pickupDistanceKm !== null && pickupDistanceKm <= 3
            ? "Very close to your current location"
            : routeCompatibility === "High"
            ? "Overlaps with your active route"
            : fitsCapacity
            ? "Fits within vehicle capacity"
            : "Available standard delivery",
      },
    };
  });

  // Sort by ranking: fitsCapacity first, then priority, then pickupDistanceKm (if available), then createdAt
  enrichedDeliveries.sort((a, b) => {
    if (a.ranking.fitsCapacity && !b.ranking.fitsCapacity) return -1;
    if (!a.ranking.fitsCapacity && b.ranking.fitsCapacity) return 1;

    const priorityWeight = { urgent: 3, high: 2, normal: 1 };
    const pA = priorityWeight[(a.facts.priority as "urgent" | "high" | "normal") || "normal"];
    const pB = priorityWeight[(b.facts.priority as "urgent" | "high" | "normal") || "normal"];
    if (pA !== pB) return pB - pA;

    if (a.ranking.pickupDistanceKm !== null && b.ranking.pickupDistanceKm !== null) {
      return a.ranking.pickupDistanceKm - b.ranking.pickupDistanceKm;
    }
    return 0;
  });

  const skip = (Number(page) - 1) * Number(limit);
  const paginated = enrichedDeliveries.slice(skip, skip + Number(limit));

  sendPaginated(res, paginated, total, Number(page), Number(limit));
});

/** GET /delivery/requests/my - My active & historical deliveries */
export const getMyDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const { status, timeRange, page = "1", limit = "20" } = req.query as {
    status?: string;
    timeRange?: "today" | "week" | "month" | "all";
    page?: string;
    limit?: string;
  };

  const filter: Record<string, unknown> = { assignedDeliveryManId: req.user!.id };

  if (status && status !== "all") {
    filter.status = {
      $in: Array.isArray(status)
        ? status
        : typeof status === "string" && status.includes(",")
        ? status.split(",")
        : [status],
    };
  }

  if (timeRange && timeRange !== "all") {
    const now = new Date();
    if (timeRange === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      filter.createdAt = { $gte: startOfDay };
    } else if (timeRange === "week") {
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: startOfWeek };
    } else if (timeRange === "month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      filter.createdAt = { $gte: startOfMonth };
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [deliveries, total] = await Promise.all([
    DeliveryRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    DeliveryRequest.countDocuments(filter),
  ]);

  const enrichDeliveryItem = (d: any) => {
    const norm = normalizeLean(d as unknown as Record<string, unknown>);
    return {
      ...norm,
      pickupCoordinates: norm.pickupCoordinates || getApproxCoordinatesFromAddress(d.pickupAddress),
      deliveryCoordinates: norm.deliveryCoordinates || getApproxCoordinatesFromAddress(d.deliveryAddress),
    };
  };

  sendPaginated(res, deliveries.map(enrichDeliveryItem), total, Number(page), Number(limit));
});

/**
 * PATCH /delivery/requests/:id/accept
 * ATOMIC FIRST-COME-FIRST-SERVED CLAIM (Race Condition Safe)
 */
export const acceptDelivery = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  // 1. Verify delivery man is approved & active
  const profile = await DeliveryManProfile.findOne({ userId });
  if (!profile || profile.status !== "approved") {
    throw ApiError.forbidden("Your delivery partner account is not approved.");
  }

  // 2. Verify rider capacity & status (parcel count & vehicle weight)
  const details = await DeliveryManDetails.findOne({ userId }).lean();
  if (details?.availabilityStatus === "on_break") {
    throw ApiError.badRequest("You are currently on break. Please resume availability before accepting new deliveries.");
  }
  if (details?.availabilityStatus === "suspended") {
    throw ApiError.forbidden("Your delivery partner account is suspended.");
  }
  if (details?.availabilityStatus === "offline") {
    throw ApiError.badRequest("You are currently offline. Please go online before accepting deliveries.");
  }

  const maxActiveParcels = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;

  const activeDeliveries = await DeliveryRequest.find({
    assignedDeliveryManId: userId,
    status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
  }).lean();

  if (activeDeliveries.length >= maxActiveParcels) {
    throw ApiError.badRequest(
      `Capacity full: You currently have ${activeDeliveries.length} active deliveries. Your maximum active capacity is ${maxActiveParcels}.`
    );
  }

  // Check vehicle weight limit if target package specifies weight
  const targetRequest = await DeliveryRequest.findById(id).lean();
  if (!targetRequest) {
    throw ApiError.notFound("Delivery request not found");
  }

  const vType = details?.vehicle?.vehicleType;
  const maxCapacityWeight = details?.vehicle?.vehicleCapacity
    ? details.vehicle.vehicleCapacity * 5
    : vType === "van"
    ? 50
    : vType === "car"
    ? 30
    : vType === "motorcycle"
    ? 20
    : vType === "bicycle"
    ? 10
    : 15;

  const currentLoadedWeight = activeDeliveries.reduce((sum, d) => sum + (d.packageInfo?.weight || 0), 0);
  const incomingWeight = targetRequest.packageInfo?.weight || 0;

  if (incomingWeight > 0 && currentLoadedWeight + incomingWeight > maxCapacityWeight) {
    const remaining = Math.max(0, maxCapacityWeight - currentLoadedWeight);
    throw ApiError.badRequest(
      `Weight capacity exceeded: Vehicle limit is ${maxCapacityWeight}kg (currently loaded: ${currentLoadedWeight}kg, remaining: ${remaining}kg). This package weighs ${incomingWeight}kg.`
    );
  }

  // 3. Atomically claim the request (1st transaction wins; subsequent parallel requests return null)
  const otp = generateOtp();
  const claimedRequest = await DeliveryRequest.findOneAndUpdate(
    {
      _id: id,
      status: "available",
      assignedDeliveryManId: { $in: [null, undefined, ""] },
    },
    {
      $set: {
        status: "assigned",
        assignedDeliveryManId: userId,
        assignedAt: new Date(),
        acceptedAt: new Date(),
        deliveryOtp: otp,
      },
    },
    { new: true }
  );

  if (!claimedRequest) {
    const existing = await DeliveryRequest.findById(id);
    if (!existing) {
      throw ApiError.notFound("Delivery request not found");
    }
    // Already claimed by another delivery man -> 409 Conflict
    throw ApiError.conflict("Another delivery man accepted this request first.");
  }

  // 4. Update corresponding Order model
  await Order.findByIdAndUpdate(claimedRequest.orderId, {
    deliveryManId: userId,
    assignedAt: new Date(),
    deliveryOtp: otp,
  });

  // 5. Update rider totalDeliveries and availability
  const newActiveCount = activeDeliveries.length + 1;
  const isNowFull = newActiveCount >= maxActiveParcels;
  await DeliveryManDetails.updateOne(
    { userId },
    {
      $inc: { totalDeliveries: 1 },
      availabilityStatus: isNowFull ? "full_capacity" : "busy",
      isActive: true,
      lastActiveAt: new Date(),
    }
  );

  // 6. Broadcast Realtime Socket Events
  emitDeliveryEvent(claimedRequest.id, "delivery:accepted", {
    deliveryId: claimedRequest.id,
    orderId: claimedRequest.orderId,
    riderId: userId,
    riderName: details?.personal?.fullName || "Courier",
    acceptedAt: new Date().toISOString(),
  });

  emitAdminOperationsEvent("admin:delivery_assigned", {
    deliveryId: claimedRequest.id,
    orderId: claimedRequest.orderId,
    riderId: userId,
  });

  // 7. Notify seller & customer
  createNotification({
    userId: claimedRequest.sellerId,
    type: "delivery_alert",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Delivery Partner Assigned",
    message: `A delivery partner has accepted order #${claimedRequest.orderId}. They will arrive shortly for pickup.`,
    link: `/dashboard/seller/orders`,
    relatedId: claimedRequest.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  createNotification({
    userId: claimedRequest.customerId,
    type: "delivery_alert",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Delivery Partner Found",
    message: `A delivery partner is assigned to order #${claimedRequest.orderId} and is heading for package pickup.`,
    link: `/orders/${claimedRequest.orderId}`,
    relatedId: claimedRequest.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  sendSuccess(res, { deliveryRequest: claimedRequest.toJSON(), deliveryOtp: otp }, "Delivery accepted successfully");
});

/** PATCH /delivery/requests/:id/status - Status State Machine */
export const updateDeliveryStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, failureReason } = req.body as { status: DeliveryRequestStatus; failureReason?: string };
  const userId = req.user!.id;

  const validTransitions: Record<DeliveryRequestStatus, DeliveryRequestStatus[]> = {
    available: ["assigned", "cancelled"],
    assigned: ["pickup_started", "cancelled", "failed"],
    pickup_started: ["picked_up", "failed", "cancelled"],
    picked_up: ["in_transit", "failed"],
    in_transit: ["out_for_delivery", "failed"],
    out_for_delivery: ["delivered", "failed", "rescheduled"],
    delivered: [],
    failed: ["rescheduled", "available"],
    cancelled: ["available"],
    rescheduled: ["available", "in_transit"],
  };

  const deliveryRequest = await DeliveryRequest.findById(id);
  if (!deliveryRequest) throw ApiError.notFound("Delivery request not found");

  if (deliveryRequest.assignedDeliveryManId !== userId && req.user!.role !== "admin") {
    throw ApiError.forbidden("You can only update deliveries assigned to you");
  }

  const allowedTransitions = validTransitions[deliveryRequest.status];
  if (!allowedTransitions.includes(status)) {
    throw ApiError.badRequest(`Cannot transition from ${deliveryRequest.status} to ${status}`);
  }

  deliveryRequest.status = status;
  const now = new Date();

  if (status === "pickup_started") deliveryRequest.pickupStartedAt = now;
  if (status === "picked_up") deliveryRequest.pickedUpAt = now;
  if (status === "in_transit") deliveryRequest.inTransitAt = now;
  if (status === "out_for_delivery") deliveryRequest.outForDeliveryAt = now;
  if (status === "delivered") deliveryRequest.deliveredAt = now;
  if (status === "failed") {
    deliveryRequest.failedAt = now;
    if (failureReason) deliveryRequest.deliveryFailedReason = failureReason;
  }

  await deliveryRequest.save();

  // Sync status to Order model
  const orderStatusMap: Partial<Record<DeliveryRequestStatus, string>> = {
    pickup_started: "processing",
    picked_up: "shipped",
    in_transit: "shipped",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    failed: "returned",
  };

  const targetOrderStatus = orderStatusMap[status];
  if (targetOrderStatus) {
    const order = await Order.findById(deliveryRequest.orderId);
    if (order) {
      order.status = targetOrderStatus as typeof order.status;
      order.statusHistory.push({ status: order.status, at: now });
      if (status === "picked_up") order.pickedUpAt = now;
      if (status === "in_transit") order.inTransitAt = now;
      if (status === "out_for_delivery") order.outForDeliveryAt = now;
      if (status === "delivered") {
        order.paymentStatus = "paid";
        order.deliveredAt = now;
      }
      if (status === "failed") {
        order.deliveryFailedAt = now;
        if (failureReason) order.deliveryFailedReason = failureReason;
      }
      await order.save();
    }
  }

  // Update rider metrics & availability
  if (status === "delivered") {
    await DeliveryManDetails.updateOne(
      { userId },
      { $inc: { completedDeliveries: 1 } }
    );
  } else if (status === "failed") {
    await DeliveryManDetails.updateOne(
      { userId },
      { $inc: { failedDeliveries: 1 } }
    );
  }

  // Recalculate rider availability based on active count
  const activeCount = await DeliveryRequest.countDocuments({
    assignedDeliveryManId: userId,
    status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
  });
  const details = await DeliveryManDetails.findOne({ userId }).lean();
  const maxActive = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;
  const newStatus = activeCount === 0 ? "available" : activeCount >= maxActive ? "full_capacity" : "busy";
  await DeliveryManDetails.updateOne(
    { userId },
    { availabilityStatus: newStatus }
  );

  // Send real notifications
  const notificationTitles: Partial<Record<DeliveryRequestStatus, { title: string; message: string }>> = {
    pickup_started: {
      title: "Rider Arrived for Pickup",
      message: `Rider has arrived to pick up order #${deliveryRequest.orderId}.`,
    },
    picked_up: {
      title: "Package Picked Up",
      message: `Your package for order #${deliveryRequest.orderId} was picked up and is on its way.`,
    },
    in_transit: {
      title: "Package In Transit",
      message: `Order #${deliveryRequest.orderId} is in transit towards your delivery address.`,
    },
    out_for_delivery: {
      title: "Out for Delivery",
      message: `Order #${deliveryRequest.orderId} is out for delivery! Please provide OTP ${deliveryRequest.deliveryOtp || ""} to your rider upon arrival.`,
    },
    delivered: {
      title: "Order Delivered",
      message: `Your order #${deliveryRequest.orderId} has been successfully delivered. Please rate your delivery partner!`,
    },
    failed: {
      title: "Delivery Failed",
      message: `Delivery attempt for order #${deliveryRequest.orderId} failed: ${failureReason || "Issue encountered"}.`,
    },
  };

  const notifyInfo = notificationTitles[status];
  if (notifyInfo) {
    createNotification({
      userId: deliveryRequest.customerId,
      type: status === "delivered" ? "delivery_completed" : status === "failed" ? "delivery_failed" : "delivery_alert",
      category: "delivery",
      priority: status === "failed" ? "warning" : "info",
      source: "delivery",
      title: notifyInfo.title,
      message: notifyInfo.message,
      link: `/orders/${deliveryRequest.orderId}`,
      relatedId: deliveryRequest.orderId,
      relatedType: "order",
    }).catch(() => undefined);
  }

  // Real-time socket event broadcast to tracking subscribers & admin
  emitDeliveryEvent(deliveryRequest.id, "delivery:status_change", {
    deliveryId: deliveryRequest.id,
    orderId: deliveryRequest.orderId,
    status,
    failureReason,
    updatedAt: now.toISOString(),
  });

  emitAdminOperationsEvent("admin:delivery_status", {
    deliveryId: deliveryRequest.id,
    orderId: deliveryRequest.orderId,
    status,
    riderId: userId,
  });

  sendSuccess(res, deliveryRequest.toJSON(), status === "delivered" ? "Delivery completed successfully" : "Status updated");
});

/** GET /delivery/requests/:id - View single delivery with scoped authorization */
export const getDeliveryById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const deliveryRequest = await DeliveryRequest.findById(id).lean();
  if (!deliveryRequest) throw ApiError.notFound("Delivery request not found");

  const isDeliveryMan = deliveryRequest.assignedDeliveryManId === userId;
  const isSeller = deliveryRequest.sellerId === userId;
  const isCustomer = deliveryRequest.customerId === userId;
  const isAdmin = req.user!.role === "admin";

  if (!isDeliveryMan && !isSeller && !isCustomer && !isAdmin) {
    throw ApiError.forbidden("You are not authorized to view this delivery");
  }

  const [order, locations, ratings, incidents] = await Promise.all([
    Order.findById(deliveryRequest.orderId).lean().then((o) => (o ? normalizeLean(o as unknown as Record<string, unknown>) : null)),
    DeliveryLocation.find({ deliveryRequestId: deliveryRequest._id })
      .sort({ recordedAt: -1 })
      .limit(30)
      .lean()
      .then((locs) => normalizeLeanArray(locs)),
    DeliveryRating.find({ deliveryRequestId: deliveryRequest._id })
      .sort({ createdAt: -1 })
      .lean()
      .then((r) => normalizeLeanArray(r)),
    DeliveryIncident.find({ deliveryRequestId: deliveryRequest._id })
      .sort({ createdAt: -1 })
      .lean()
      .then((inc) => normalizeLeanArray(inc)),
  ]);

  const pickupCoordinates = getApproxCoordinatesFromAddress(deliveryRequest.pickupAddress);
  const deliveryCoordinates = getApproxCoordinatesFromAddress(deliveryRequest.deliveryAddress);

  const enrichedDeliveryRequest = {
    ...normalizeLean(deliveryRequest as unknown as Record<string, unknown>),
    pickupCoordinates,
    deliveryCoordinates,
  };

  sendSuccess(res, {
    deliveryRequest: enrichedDeliveryRequest,
    pickupCoordinates,
    deliveryCoordinates,
    order,
    locations,
    ratings,
    incidents,
  });
});

/** PATCH /delivery/requests/:id/verify-otp - Delivery OTP validation */
export const verifyDeliveryOtp = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { otp } = req.body as { otp: string };
  const userId = req.user!.id;

  const deliveryRequest = await DeliveryRequest.findById(id);
  if (!deliveryRequest) throw ApiError.notFound("Delivery request not found");

  if (deliveryRequest.assignedDeliveryManId !== userId && req.user!.role !== "admin") {
    throw ApiError.forbidden("You can only verify OTP for deliveries assigned to you");
  }

  if (deliveryRequest.status !== "out_for_delivery" && deliveryRequest.status !== "in_transit") {
    throw ApiError.badRequest("Cannot verify OTP when order is not out for delivery");
  }

  // Attempt rate guard
  if ((deliveryRequest.attemptCount || 0) >= 5) {
    throw ApiError.badRequest("Too many failed OTP verification attempts. Please contact customer support.");
  }

  if (deliveryRequest.deliveryOtp !== otp.trim()) {
    deliveryRequest.attemptCount = (deliveryRequest.attemptCount || 0) + 1;
    await deliveryRequest.save();
    throw ApiError.badRequest("Invalid delivery OTP. Please verify with the customer.");
  }

  const now = new Date();
  deliveryRequest.deliveryOtpVerifiedAt = now;
  deliveryRequest.status = "delivered";
  deliveryRequest.deliveredAt = now;
  deliveryRequest.attemptCount = 0;
  await deliveryRequest.save();

  // Sync to order
  const order = await Order.findById(deliveryRequest.orderId);
  if (order) {
    order.status = "delivered";
    order.paymentStatus = "paid";
    order.deliveredAt = now;
    order.statusHistory.push({ status: "delivered", at: now });
    await order.save();
  }

  // Update rider metrics
  await DeliveryManDetails.updateOne(
    { userId },
    { $inc: { completedDeliveries: 1 } }
  );

  // Recalculate availability
  const activeCount = await DeliveryRequest.countDocuments({
    assignedDeliveryManId: userId,
    status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
  });
  const details = await DeliveryManDetails.findOne({ userId }).lean();
  const maxActive = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;
  const newStatus = activeCount === 0 ? "available" : activeCount >= maxActive ? "full_capacity" : "busy";
  await DeliveryManDetails.updateOne(
    { userId },
    { availabilityStatus: newStatus }
  );

  // Broadcast socket events
  emitDeliveryEvent(deliveryRequest.id, "delivery:delivered", {
    deliveryId: deliveryRequest.id,
    orderId: deliveryRequest.orderId,
    deliveredAt: now.toISOString(),
  });

  emitAdminOperationsEvent("admin:delivery_completed", {
    deliveryId: deliveryRequest.id,
    orderId: deliveryRequest.orderId,
    riderId: userId,
  });

  // Send completion notifications
  createNotification({
    userId: deliveryRequest.customerId,
    type: "delivery_completed",
    category: "delivery",
    priority: "info",
    source: "delivery",
    title: "Order Delivered Successfully",
    message: `Your order #${deliveryRequest.orderId} was delivered. Please take a moment to rate your delivery partner.`,
    link: `/orders/${deliveryRequest.orderId}`,
    relatedId: deliveryRequest.orderId,
    relatedType: "order",
  }).catch(() => undefined);

  sendSuccess(res, deliveryRequest.toJSON(), "OTP verified & order marked as delivered successfully");
});

/** POST /delivery/requests/:id/proof - Upload proof of delivery photo */
export const uploadDeliveryProof = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) throw ApiError.badRequest("No proof image file provided");

  const deliveryRequest = await DeliveryRequest.findById(id);
  if (!deliveryRequest) throw ApiError.notFound("Delivery request not found");

  if (deliveryRequest.assignedDeliveryManId !== req.user!.id && req.user!.role !== "admin") {
    throw ApiError.forbidden("You can only upload proof for your own deliveries");
  }

  const proofUrl = `/uploads/delivery/${file.filename}`;
  deliveryRequest.deliveryProofImage = proofUrl;
  await deliveryRequest.save();

  await Order.findByIdAndUpdate(deliveryRequest.orderId, {
    deliveryProofImage: proofUrl,
  });

  emitDeliveryEvent(deliveryRequest.id, "delivery:proof_uploaded", {
    deliveryId: deliveryRequest.id,
    orderId: deliveryRequest.orderId,
    deliveryProofImage: proofUrl,
  });

  sendSuccess(res, { deliveryProofImage: proofUrl }, "Proof of delivery uploaded successfully");
});

/** POST /delivery/incidents - Report delivery incident (general or order-specific) */
export const createDeliveryIncident = asyncHandler(async (req: Request, res: Response) => {
  const { deliveryRequestId, orderId, category, severity, description, evidenceImages } = req.body as {
    deliveryRequestId?: string;
    orderId?: string;
    category: any;
    severity?: "low" | "medium" | "high" | "critical";
    description: string;
    evidenceImages?: string[];
  };

  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";

  let linkedDelivery: any = null;
  const targetDelId = deliveryRequestId || orderId;

  if (targetDelId && targetDelId !== "general") {
    const isObjId = mongoose.isValidObjectId(targetDelId);
    linkedDelivery = await DeliveryRequest.findOne({
      $or: [
        ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(targetDelId) }] : []),
        { orderId: targetDelId },
      ],
    });

    if (linkedDelivery) {
      if (linkedDelivery.assignedDeliveryManId !== userId && !isAdmin) {
        throw ApiError.forbidden("You can only report incidents for your assigned deliveries");
      }
    }
  }

  const incident = await DeliveryIncident.create({
    deliveryRequestId: linkedDelivery?.id || (deliveryRequestId && deliveryRequestId !== "general" ? deliveryRequestId : undefined),
    orderId: linkedDelivery?.orderId || orderId || undefined,
    deliveryManId: userId,
    category,
    severity: severity || "medium",
    description,
    evidenceImages: evidenceImages || [],
    status: "open",
  });

  if (linkedDelivery) {
    emitDeliveryEvent(linkedDelivery.id, "delivery:incident_reported", {
      deliveryId: linkedDelivery.id,
      orderId: linkedDelivery.orderId,
      incident: incident.toJSON(),
    });

    createNotification({
      userId: linkedDelivery.sellerId,
      type: "incident_alert",
      category: "delivery",
      priority: severity === "critical" ? "high" : "warning",
      source: "delivery",
      title: "Delivery Incident Reported",
      message: `An incident (${category.replace(/_/g, " ")}) was reported for order #${linkedDelivery.orderId}.`,
      link: `/dashboard/seller/orders`,
      relatedId: incident.id,
      relatedType: "delivery",
    }).catch(() => undefined);
  }

  emitAdminOperationsEvent("admin:incident_reported", {
    incidentId: incident.id,
    deliveryId: linkedDelivery?.id,
    category,
    severity: severity || "medium",
    riderId: userId,
  });

  sendSuccess(res, { incident: incident.toJSON() }, "Incident reported successfully", 201);
});

/** POST /delivery/requests/:id/incident - Backward compatible delivery incident route */
export const reportDeliveryIncident = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { category, severity, description, evidenceImages } = req.body as {
    category: any;
    severity?: "low" | "medium" | "high" | "critical";
    description: string;
    evidenceImages?: string[];
  };

  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";

  let linkedDelivery: any = null;

  if (id && id !== "general") {
    const isObjId = mongoose.isValidObjectId(id);
    linkedDelivery = await DeliveryRequest.findOne({
      $or: [
        ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
        { orderId: id },
      ],
    });

    if (!linkedDelivery) {
      throw ApiError.notFound("Delivery request not found");
    }

    if (linkedDelivery.assignedDeliveryManId !== userId && !isAdmin) {
      throw ApiError.forbidden("You can only report incidents for your assigned deliveries");
    }
  }

  const incident = await DeliveryIncident.create({
    deliveryRequestId: linkedDelivery?.id || (id !== "general" ? id : undefined),
    orderId: linkedDelivery?.orderId,
    deliveryManId: userId,
    category,
    severity: severity || "medium",
    description,
    evidenceImages: evidenceImages || [],
    status: "open",
  });

  if (linkedDelivery) {
    emitDeliveryEvent(linkedDelivery.id, "delivery:incident_reported", {
      deliveryId: linkedDelivery.id,
      orderId: linkedDelivery.orderId,
      incident: incident.toJSON(),
    });

    createNotification({
      userId: linkedDelivery.sellerId,
      type: "incident_alert",
      category: "delivery",
      priority: severity === "critical" ? "high" : "warning",
      source: "delivery",
      title: "Delivery Incident Reported",
      message: `An incident (${category.replace(/_/g, " ")}) was reported for order #${linkedDelivery.orderId}.`,
      link: `/dashboard/seller/orders`,
      relatedId: incident.id,
      relatedType: "delivery",
    }).catch(() => undefined);
  }

  emitAdminOperationsEvent("admin:incident_reported", {
    incidentId: incident.id,
    deliveryId: linkedDelivery?.id,
    category,
    severity: severity || "medium",
    riderId: userId,
  });

  sendSuccess(res, { incident: incident.toJSON() }, "Incident reported successfully", 201);
});

/** GET /delivery/seller/active-deliveries - Real-time active deliveries scoped strictly to seller */
export const getSellerActiveDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const { status } = req.query as { status?: string };

  const filter: Record<string, unknown> = {
    sellerId,
  };

  if (status && status !== "all") {
    filter.status = status;
  } else {
    filter.status = {
      $in: ["available", "assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery", "delivered"],
    };
  }

  const deliveries = await DeliveryRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const riderIds = deliveries
    .map((d) => d.assignedDeliveryManId)
    .filter((id): id is string => Boolean(id));

  const [riderDetails, riderProfiles] = await Promise.all([
    DeliveryManDetails.find({ userId: { $in: riderIds } }).lean(),
    DeliveryManProfile.find({ userId: { $in: riderIds } }).lean(),
  ]);

  const detailsMap = new Map(riderDetails.map((d) => [d.userId, d]));
  const profileMap = new Map(riderProfiles.map((p) => [p.userId, p]));

  const enrichedDeliveries = deliveries.map((d) => {
    let assignedRider: any = null;
    let currentLocation: any = null;

    if (d.assignedDeliveryManId) {
      const details = detailsMap.get(d.assignedDeliveryManId);
      const profile = profileMap.get(d.assignedDeliveryManId);

      assignedRider = {
        name: details?.personal?.fullName || "Assigned Courier",
        phone: details?.personal?.phone,
        rating: details?.rating || 5.0,
        vehicleType: details?.vehicle?.vehicleType || "Motorcycle",
        status: profile?.status || "approved",
      };

      const isLive = ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"].includes(d.status);
      if (
        isLive &&
        details?.currentLocation?.latitude !== undefined &&
        details?.currentLocation?.latitude !== null &&
        details?.currentLocation?.longitude !== undefined &&
        details?.currentLocation?.longitude !== null
      ) {
        currentLocation = {
          latitude: details.currentLocation.latitude,
          longitude: details.currentLocation.longitude,
          speed: details.currentLocation.speed,
          heading: details.currentLocation.heading,
          accuracy: details.currentLocation.accuracy,
          updatedAt: details.currentLocation.updatedAt ? new Date(details.currentLocation.updatedAt).toISOString() : new Date().toISOString(),
        };
      }
    }

    return {
      ...normalizeLean(d as unknown as Record<string, unknown>),
      pickupCoordinates: getApproxCoordinatesFromAddress(d.pickupAddress),
      deliveryCoordinates: getApproxCoordinatesFromAddress(d.deliveryAddress),
      assignedRider,
      currentLocation,
    };
  });

  sendSuccess(res, enrichedDeliveries);
});

/** GET /delivery/incidents - List incidents for authenticated delivery man */
export const getMyIncidents = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const incidents = await DeliveryIncident.find({ deliveryManId: userId })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, normalizeLeanArray(incidents));
});

/**
 * GET /delivery/tracking/:orderId
 * Real-time Location Tracking Scoped to Authorized Customer/Admin/Rider
 */
export const getDeliveryTracking = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const userId = req.user!.id;
  const userRole = req.user!.role;

  const deliveryRequest = await DeliveryRequest.findOne({ orderId }).lean();
  if (!deliveryRequest) throw ApiError.notFound("No delivery request found for this order");

  const isCustomerOwner = deliveryRequest.customerId === userId;
  const isAssignedRider = deliveryRequest.assignedDeliveryManId === userId;
  const isSellerOwner = deliveryRequest.sellerId === userId;
  const isAdmin = userRole === "admin";

  if (!isCustomerOwner && !isAssignedRider && !isSellerOwner && !isAdmin) {
    throw ApiError.forbidden("You are not authorized to track this delivery");
  }

  // Get rider details (public profile only)
  let riderInfo: Record<string, unknown> | null = null;
  if (deliveryRequest.assignedDeliveryManId) {
    const [riderDetails, riderProfile] = await Promise.all([
      DeliveryManDetails.findOne({ userId: deliveryRequest.assignedDeliveryManId }).lean(),
      DeliveryManProfile.findOne({ userId: deliveryRequest.assignedDeliveryManId }).lean(),
    ]);

    let riderName = riderDetails?.personal?.fullName || "Assigned Courier";
    let riderAvatar = riderDetails?.personal?.profilePhoto || null;

    if (!riderName || riderName === "Assigned Courier") {
      const db = mongoose.connection.db;
      if (db) {
        const u = await db.collection("user").findOne({
          $or: [
            { id: deliveryRequest.assignedDeliveryManId },
            ...(mongoose.isValidObjectId(deliveryRequest.assignedDeliveryManId)
              ? [{ _id: new mongoose.Types.ObjectId(deliveryRequest.assignedDeliveryManId) }]
              : []),
          ],
        });
        if (u) {
          riderName = u.name || riderName;
          riderAvatar = u.image || riderAvatar;
        }
      }
    }

    riderInfo = {
      name: riderName,
      avatar: riderAvatar,
      phone: riderDetails?.personal?.phone,
      rating: riderDetails?.rating || 5.0,
      ratingCount: riderDetails?.ratingCount || 0,
      vehicleType: riderDetails?.vehicle?.vehicleType || "Motorcycle",
      vehicleModel: riderDetails?.vehicle?.vehicleModel || "",
      vehicleRegistrationNumber: riderDetails?.vehicle?.vehicleRegistrationNumber || "",
      status: riderProfile?.status || "approved",
    };
  }

  // Location is ONLY live if delivery is currently active (picked_up, in_transit, out_for_delivery)
  const isLiveTrackingActive = ["picked_up", "in_transit", "out_for_delivery"].includes(deliveryRequest.status);

  let currentLocation: { latitude: number; longitude: number; updatedAt?: Date } | null = null;
  let recentBreadcrumbs: any[] = [];

  if (isLiveTrackingActive && deliveryRequest.assignedDeliveryManId) {
    const details = await DeliveryManDetails.findOne({ userId: deliveryRequest.assignedDeliveryManId }).lean();
    if (
      details?.currentLocation?.latitude !== undefined &&
      details?.currentLocation?.latitude !== null &&
      details?.currentLocation?.longitude !== undefined &&
      details?.currentLocation?.longitude !== null
    ) {
      currentLocation = {
        latitude: details.currentLocation.latitude,
        longitude: details.currentLocation.longitude,
        updatedAt: details.currentLocation.updatedAt ? new Date(details.currentLocation.updatedAt) : undefined,
      };
    }

    recentBreadcrumbs = await DeliveryLocation.find({ deliveryRequestId: deliveryRequest._id })
      .sort({ recordedAt: -1 })
      .limit(10)
      .lean();
  }

  sendSuccess(res, {
    orderId: deliveryRequest.orderId,
    status: deliveryRequest.status,
    isLiveTrackingActive,
    assignedRider: riderInfo,
    currentLocation,
    breadcrumbs: normalizeLeanArray(recentBreadcrumbs),
    timestamps: {
      assignedAt: deliveryRequest.assignedAt,
      pickupStartedAt: deliveryRequest.pickupStartedAt,
      pickedUpAt: deliveryRequest.pickedUpAt,
      inTransitAt: deliveryRequest.inTransitAt,
      outForDeliveryAt: deliveryRequest.outForDeliveryAt,
      deliveredAt: deliveryRequest.deliveredAt,
    },
    pickupAddress: deliveryRequest.pickupAddress,
    deliveryAddress: deliveryRequest.deliveryAddress,
    pickupCoordinates: getApproxCoordinatesFromAddress(deliveryRequest.pickupAddress),
    deliveryCoordinates: getApproxCoordinatesFromAddress(deliveryRequest.deliveryAddress),
  });
});

/** POST /delivery/requests/:id/rate or POST /delivery/orders/:orderId/rate - Customer rates delivery partner */
export const rateDelivery = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id || req.params.orderId;
  const { rating, professionalism, timeliness, communication, comment } = req.body as {
    rating: number;
    professionalism?: number;
    timeliness?: number;
    communication?: number;
    comment?: string;
  };

  if (!rating || rating < 1 || rating > 5) {
    throw ApiError.badRequest("Rating must be between 1 and 5");
  }

  // 1. Try to find delivery request by _id OR orderId
  const isObjId = mongoose.isValidObjectId(targetId);
  let deliveryRequest = await DeliveryRequest.findOne({
    $or: [
      ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(targetId) }] : []),
      { orderId: targetId },
    ],
  });

  let orderDoc: any = null;
  if (!deliveryRequest) {
    orderDoc = await Order.findOne({
      $or: [
        ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(targetId) }] : []),
        { id: targetId },
      ],
    });
    if (!orderDoc) {
      throw ApiError.notFound("Delivery record or order not found");
    }
  } else {
    orderDoc = await Order.findById(deliveryRequest.orderId);
  }

  const effectiveDeliveryManId = deliveryRequest?.assignedDeliveryManId || orderDoc?.deliveryManId;
  const isDelivered = deliveryRequest?.status === "delivered" || orderDoc?.status === "delivered";
  const customerId = deliveryRequest?.customerId || orderDoc?.userId;

  if (!effectiveDeliveryManId) {
    throw ApiError.badRequest("Delivery Man rating is unavailable for this order.");
  }

  if (!isDelivered) {
    throw ApiError.badRequest("You can only rate a completed delivery");
  }

  if (customerId !== req.user!.id && req.user!.role !== "admin") {
    throw ApiError.forbidden("Only the customer of this order can submit a rating");
  }

  const orderIdStr = String(deliveryRequest?.orderId || orderDoc?._id || targetId);
  const deliveryReqIdStr = deliveryRequest ? String(deliveryRequest._id) : orderIdStr;

  // Check for duplicate rating by deliveryRequestId OR orderId
  const existing = await DeliveryRating.findOne({
    $or: [
      { deliveryRequestId: deliveryReqIdStr },
      { orderId: orderIdStr },
    ],
  });
  if (existing) {
    throw ApiError.badRequest("You have already rated this delivery partner for this order");
  }

  const savedRating = await DeliveryRating.create({
    deliveryRequestId: deliveryReqIdStr,
    orderId: orderIdStr,
    deliveryManId: effectiveDeliveryManId,
    customerId: req.user!.id,
    rating,
    professionalism: professionalism ?? rating,
    timeliness: timeliness ?? rating,
    communication: communication ?? rating,
    comment,
  });

  // Recompute rider aggregate rating
  const stats = await DeliveryRating.aggregate([
    { $match: { deliveryManId: effectiveDeliveryManId } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = stats[0]?.avgRating ?? rating;
  const count = stats[0]?.count ?? 1;

  await DeliveryManDetails.updateOne(
    { userId: effectiveDeliveryManId },
    { rating: Math.round(avg * 10) / 10, ratingCount: count }
  );

  sendSuccess(
    res,
    {
      rating: savedRating.rating,
      professionalism: savedRating.professionalism,
      timeliness: savedRating.timeliness,
      communication: savedRating.communication,
      comment: savedRating.comment,
      createdAt: savedRating.createdAt,
    },
    "Thank you! Rating submitted successfully."
  );
});

/** GET /delivery/stats - Real computed metrics for rider */
export const getDeliveryManStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [profile, details, statsByStatus, completedDeliveries] = await Promise.all([
    DeliveryManProfile.findOne({ userId }).lean(),
    DeliveryManDetails.findOne({ userId }).lean(),
    DeliveryRequest.aggregate([
      { $match: { assignedDeliveryManId: userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    DeliveryRequest.find({ assignedDeliveryManId: userId, status: "delivered" }).lean(),
  ]);

  const statusCounts = statsByStatus.reduce<Record<string, number>>((acc, s) => {
    acc[s._id] = s.count;
    return acc;
  }, {});

  // Compute real total earnings from deliveryFee
  const totalEarnings = completedDeliveries.reduce((sum, d) => sum + (d.deliveryFee || 60), 0);

  // Compute today's metrics
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDeliveries = completedDeliveries.filter((d) => d.deliveredAt && new Date(d.deliveredAt) >= startOfDay);
  const todayEarnings = todayDeliveries.reduce((sum, d) => sum + (d.deliveryFee || 60), 0);

  // Compute average delivery duration in minutes for completed deliveries
  let totalDurationMinutes = 0;
  let durationCount = 0;
  for (const d of completedDeliveries) {
    const start = d.pickedUpAt || d.acceptedAt;
    const end = d.deliveredAt;
    if (start && end) {
      const diffMs = new Date(end).getTime() - new Date(start).getTime();
      if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
        totalDurationMinutes += diffMs / (1000 * 60);
        durationCount += 1;
      }
    }
  }
  const avgDeliveryTimeMinutes = durationCount > 0 ? Math.round(totalDurationMinutes / durationCount) : 0;

  const totalDeliveries = (details?.totalDeliveries || 0) > 0 ? details!.totalDeliveries : (statusCounts.delivered || 0) + (statusCounts.failed || 0);
  const completedCount = statusCounts.delivered || details?.completedDeliveries || 0;
  const failedCount = statusCounts.failed || details?.failedDeliveries || 0;
  const activeCount = (statusCounts.assigned || 0) + (statusCounts.pickup_started || 0) + (statusCounts.picked_up || 0) + (statusCounts.in_transit || 0) + (statusCounts.out_for_delivery || 0);

  sendSuccess(res, {
    profile: profile ? normalizeLean(profile as unknown as Record<string, unknown>) : null,
    details: details ? normalizeLean(details as unknown as Record<string, unknown>) : null,
    stats: {
      availabilityStatus: details?.availabilityStatus ?? "offline",
      isActive: details?.isActive ?? false,
      totalDeliveries,
      completedDeliveries: completedCount,
      failedDeliveries: failedCount,
      activeDeliveries: activeCount,
      todayDeliveries: todayDeliveries.length,
      todayEarnings,
      totalEarnings,
      avgDeliveryTimeMinutes,
      rating: details?.rating ?? 0,
      ratingCount: details?.ratingCount ?? 0,
      deliveriesByStatus: statusCounts,
    },
  });
});

/** Admin: List delivery men with filters & search */
export const listDeliveryMen = asyncHandler(async (req: Request, res: Response) => {
  const { status, search, page = "1", limit = "20" } = req.query as {
    status?: string;
    search?: string;
    page?: string;
    limit?: string;
  };

  const filter: Record<string, unknown> = {};
  if (status && status !== "all") filter.status = status;

  const profiles = await DeliveryManProfile.find(filter).lean();
  const userIds = profiles.map((p) => p.userId);

  const db = mongoose.connection.db;
  let userDocs: any[] = [];
  if (db && userIds.length > 0) {
    const orQueries = userIds.map((id) => ({
      id,
      ...(mongoose.isValidObjectId(id) ? { _id: new mongoose.Types.ObjectId(id) } : {}),
    }));
    userDocs = await db.collection("user").find({ $or: orQueries }).toArray();
  }

  const userMap = new Map<string, any>();
  for (const u of userDocs) {
    userMap.set(String(u.id ?? u._id), u);
  }

  const details = await DeliveryManDetails.find({ userId: { $in: userIds } }).lean();
  const detailsMap = new Map(details.map((d) => [d.userId, d]));

  let items = profiles.map((profile) => {
    const d = detailsMap.get(profile.userId);
    const u = userMap.get(profile.userId);
    return {
      profile: normalizeLean(profile as unknown as Record<string, unknown>),
      personal: d?.personal ? normalizeLean(d.personal as unknown as Record<string, unknown>) : undefined,
      identity: d?.identity ? normalizeLean(d.identity as unknown as Record<string, unknown>) : undefined,
      license: d?.license ? normalizeLean(d.license as unknown as Record<string, unknown>) : undefined,
      vehicle: d?.vehicle ? normalizeLean(d.vehicle as unknown as Record<string, unknown>) : undefined,
      bank: d?.bank ? normalizeLean(d.bank as unknown as Record<string, unknown>) : undefined,
      preferences: d?.preferences ? normalizeLean(d.preferences as unknown as Record<string, unknown>) : undefined,
      availabilityStatus: d?.availabilityStatus ?? "offline",
      isActive: d?.isActive ?? false,
      rating: d?.rating ?? 0,
      ratingCount: d?.ratingCount ?? 0,
      totalDeliveries: d?.totalDeliveries ?? 0,
      completedDeliveries: d?.completedDeliveries ?? 0,
      failedDeliveries: d?.failedDeliveries ?? 0,
      currentLocation: d?.currentLocation ? normalizeLean(d.currentLocation as unknown as Record<string, unknown>) : undefined,
      name: d?.personal?.fullName || u?.name || "Delivery Partner",
      email: d?.personal?.email || u?.email || "",
      image: d?.personal?.profilePhoto || u?.image || "",
    };
  });

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        (item.personal && typeof (item.personal as any).phone === "string" && (item.personal as any).phone.includes(q))
    );
  }

  const total = items.length;
  const skip = (Number(page) - 1) * Number(limit);
  const paginatedItems = items.slice(skip, skip + Number(limit));

  sendSuccess(res, {
    items: paginatedItems,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

/** Admin: Get full KYC & verification details for a delivery man */
export const getDeliveryManDetailAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const profile = await DeliveryManProfile.findOne({ userId }).lean();
  if (!profile) throw ApiError.notFound("Delivery partner profile not found");

  const details = await DeliveryManDetails.findOne({ userId }).lean();

  let userDoc: any = null;
  const db = mongoose.connection.db;
  if (db) {
    userDoc = await db.collection("user").findOne({
      $or: [
        { id: userId },
        ...(mongoose.isValidObjectId(userId) ? [{ _id: new mongoose.Types.ObjectId(userId) }] : []),
      ],
    });
  }

  sendSuccess(res, {
    profile: normalizeLean(profile as unknown as Record<string, unknown>),
    details: details ? normalizeLean(details as unknown as Record<string, unknown>) : null,
    user: userDoc ? { id: String(userDoc.id ?? userDoc._id), name: userDoc.name, email: userDoc.email, image: userDoc.image } : null,
  });
});

/** Admin: Approve, Reject, Suspend, or Request Resubmission */
export const approveDeliveryMan = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { status, rejectionReason } = req.body as {
    status: "approved" | "rejected" | "suspended" | "pending_verification";
    rejectionReason?: string;
  };

  const profile = await DeliveryManProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound("Delivery partner profile not found");

  profile.status = status;
  if (rejectionReason) profile.rejectionReason = rejectionReason;
  if (status === "approved") {
    profile.verifiedAt = new Date();
    profile.verifiedBy = req.user!.id;
    profile.resubmissionRequired = false;
  }
  if (status === "rejected") {
    profile.resubmissionRequired = true;
  }

  await profile.save();

  // Sync user role in database
  const db = mongoose.connection.db;
  if (db) {
    if (status === "approved") {
      await db.collection("user").updateOne(
        {
          $or: [
            { id: userId },
            ...(mongoose.isValidObjectId(userId) ? [{ _id: new mongoose.Types.ObjectId(userId) }] : []),
          ],
        },
        { $set: { role: "delivery_man" } }
      );
    }
  }

  // Send real notification to delivery partner
  createNotification({
    userId,
    type: status === "approved" ? "delivery_alert" : "incident_alert",
    category: "delivery",
    priority: status === "suspended" ? "high" : "info",
    source: "admin",
    title:
      status === "approved"
        ? "Application Approved 🎉"
        : status === "rejected"
        ? "Application Update: Rejected"
        : status === "suspended"
        ? "Account Suspended"
        : "Profile Status Updated",
    message:
      status === "approved"
        ? "Congratulations! Your delivery partner application has been approved. You can now access the Delivery Command Center and start accepting deliveries."
        : status === "rejected"
        ? `Your application was not approved: ${rejectionReason || "Please review required documents and resubmit."}`
        : "Your delivery partner account status has been updated by administration.",
    link: "/dashboard/delivery",
    relatedId: profile.id,
    relatedType: "delivery",
  }).catch(() => undefined);

  sendSuccess(res, profile.toJSON() as unknown as Record<string, unknown>, `Delivery partner ${status}`);
});

/** Admin: List all active operations & delivery requests */
export const listAdminActiveDeliveries = asyncHandler(async (_req: Request, res: Response) => {
  const [activeRequests, openRequests, deliveryMen] = await Promise.all([
    DeliveryRequest.find({
      status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
    })
      .sort({ createdAt: -1 })
      .lean(),
    DeliveryRequest.find({ status: "available" }).sort({ createdAt: -1 }).lean(),
    DeliveryManDetails.find({ isActive: true }).lean(),
  ]);

  sendSuccess(res, {
    activeDeliveries: normalizeLeanArray(activeRequests),
    openMarketplace: normalizeLeanArray(openRequests),
    activeRiders: normalizeLeanArray(deliveryMen),
  });
});

/** Admin: List delivery incidents */
export const listAdminIncidents = asyncHandler(async (req: Request, res: Response) => {
  const { status, severity } = req.query as { status?: string; severity?: string };
  const filter: Record<string, unknown> = {};
  if (status && status !== "all") filter.status = status;
  if (severity && severity !== "all") filter.severity = severity;

  const incidents = await DeliveryIncident.find(filter).sort({ createdAt: -1 }).lean();
  sendSuccess(res, normalizeLeanArray(incidents));
});

/** Admin: Resolve delivery incident */
export const resolveAdminIncident = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, resolutionNotes } = req.body as {
    status: "resolved" | "investigating" | "closed";
    resolutionNotes?: string;
  };

  const incident = await DeliveryIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");

  incident.status = status;
  if (resolutionNotes) incident.resolutionNotes = resolutionNotes;
  if (status === "resolved" || status === "closed") {
    incident.resolvedBy = req.user!.id;
    incident.resolvedAt = new Date();
  }

  await incident.save();

  sendSuccess(res, incident.toJSON(), "Incident updated successfully");
});

/** GET /delivery/admin/heatmap - Real Geospatial Delivery Demand Heatmap */
export const getAdminDeliveryHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const { timeRange = "30d" } = req.query as { timeRange?: "today" | "7d" | "30d" | "all" };

  const now = new Date();
  const filter: Record<string, unknown> = {};

  if (timeRange === "today") {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    filter.createdAt = { $gte: startOfDay };
  } else if (timeRange === "7d") {
    filter.createdAt = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
  } else if (timeRange === "30d") {
    filter.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
  }

  // Fetch real delivery requests in period
  const deliveries = await DeliveryRequest.find(filter)
    .select("pickupAddress deliveryAddress status createdAt")
    .limit(500)
    .lean();

  // Aggregate into coordinate density clusters
  const coordinateMap = new Map<string, { latitude: number; longitude: number; weight: number; count: number; address: string }>();

  for (const d of deliveries) {
    const pCoords = getApproxCoordinatesFromAddress(d.pickupAddress);
    const dCoords = getApproxCoordinatesFromAddress(d.deliveryAddress);

    if (pCoords) {
      const key = `${pCoords.latitude.toFixed(3)},${pCoords.longitude.toFixed(3)}`;
      const existing = coordinateMap.get(key) || { latitude: pCoords.latitude, longitude: pCoords.longitude, weight: 0, count: 0, address: d.pickupAddress || "" };
      existing.weight += 1;
      existing.count += 1;
      coordinateMap.set(key, existing);
    }

    if (dCoords) {
      const key = `${dCoords.latitude.toFixed(3)},${dCoords.longitude.toFixed(3)}`;
      const existing = coordinateMap.get(key) || { latitude: dCoords.latitude, longitude: dCoords.longitude, weight: 0, count: 0, address: d.deliveryAddress || "" };
      existing.weight += 1.5; // Customer dropoffs carry higher density weight
      existing.count += 1;
      coordinateMap.set(key, existing);
    }
  }

  const heatmapPoints = Array.from(coordinateMap.values());

  sendSuccess(res, {
    timeRange,
    totalDeliveriesAnalyzed: deliveries.length,
    pointCount: heatmapPoints.length,
    points: heatmapPoints,
  });
});
