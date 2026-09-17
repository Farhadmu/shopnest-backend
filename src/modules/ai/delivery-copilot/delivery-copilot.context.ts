import { DeliveryCopilotIntent, DeliveryCopilotMetric, DeliveryCopilotInsight, DeliveryCopilotSource, TimeRange } from "./delivery-copilot.types";
import { DeliveryRequest } from "../../delivery/delivery-request.model";
import { DeliveryManDetails, DeliveryManProfile } from "../../delivery/delivery-man.model";
import { DeliveryIncident } from "../../delivery/delivery-incident.model";

export interface ContextSection {
  title: string;
  metrics?: DeliveryCopilotMetric[];
  insights?: DeliveryCopilotInsight[];
  data?: Record<string, unknown>;
}

export interface BuiltDeliveryContext {
  intent: DeliveryCopilotIntent;
  timeRange: TimeRange;
  sections: ContextSection[];
  sources: DeliveryCopilotSource[];
}

export async function buildDeliveryCopilotContext(
  intent: DeliveryCopilotIntent,
  timeRange: TimeRange,
  userId: string
): Promise<BuiltDeliveryContext> {
  const sections: ContextSection[] = [];
  const sources: DeliveryCopilotSource[] = [];

  const [profile, details, activeRequests, availableRequests, completedDeliveries, incidents] = await Promise.all([
    DeliveryManProfile.findOne({ userId }).lean(),
    DeliveryManDetails.findOne({ userId }).lean(),
    DeliveryRequest.find({
      assignedDeliveryManId: userId,
      status: { $in: ["assigned", "pickup_started", "picked_up", "in_transit", "out_for_delivery"] },
    }).sort({ priority: -1, createdAt: 1 }).lean(),
    DeliveryRequest.find({ status: "available" }).sort({ priority: -1, createdAt: 1 }).limit(10).lean(),
    DeliveryRequest.find({
      assignedDeliveryManId: userId,
      status: "delivered",
      deliveredAt: { $gte: timeRange.start },
    }).lean(),
    DeliveryIncident.find({ deliveryManId: userId, status: "open" }).lean(),
  ]);

  sources.push({ name: "DeliveryRequests", type: "database", recordCount: activeRequests.length + availableRequests.length });
  sources.push({ name: "DeliveryManDetails", type: "database", recordCount: details ? 1 : 0 });

  const maxParcels = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;
  const currentActiveCount = activeRequests.length;
  const todayEarnings = completedDeliveries.reduce((sum, d) => sum + (d.deliveryFee || 60), 0);

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

  const currentLoadedWeight = activeRequests.reduce((sum, d) => sum + (d.packageInfo?.weight || 0), 0);
  const remainingWeightCapacity = Math.max(0, maxCapacityWeight - currentLoadedWeight);

  // 1. Rider Operational Status
  const statusMetrics: DeliveryCopilotMetric[] = [
    {
      label: "Active Missions",
      value: currentActiveCount,
      formatted: `${currentActiveCount} / ${maxParcels} parcels`,
    },
    {
      label: "Vehicle Load",
      value: currentLoadedWeight,
      formatted: `${currentLoadedWeight}kg / ${maxCapacityWeight}kg (${remainingWeightCapacity}kg free)`,
    },
    {
      label: "Today's Completed",
      value: completedDeliveries.length,
      formatted: `${completedDeliveries.length} orders`,
    },
    {
      label: "Today's Delivery Fees",
      value: todayEarnings,
      formatted: `৳${todayEarnings}`,
    },
    {
      label: "Customer Rating",
      value: details?.rating || 5.0,
      formatted: `${(details?.rating || 5.0).toFixed(1)} ★ (${details?.ratingCount || 0} reviews)`,
    },
  ];

  sections.push({
    title: "Rider Live Operational State",
    metrics: statusMetrics,
    data: {
      isApproved: profile?.status === "approved",
      availability: details?.availabilityStatus || "offline",
      vehicleType: vType,
      maxParcels,
      maxCapacityWeight,
      currentLoadedWeight,
      remainingWeightCapacity,
    },
  });

  // 2. Active Deliveries Breakdown & Recommended Sequence
  if (activeRequests.length > 0) {
    // Sort logic for optimal suggested sequence: urgent priority first, then out_for_delivery / in_transit, then picked_up, then assigned
    const statusWeight: Record<string, number> = {
      out_for_delivery: 4,
      in_transit: 3,
      picked_up: 2,
      pickup_started: 1,
      assigned: 0,
    };

    const sortedActive = [...activeRequests].sort((a, b) => {
      if (a.priority === "urgent" && b.priority !== "urgent") return -1;
      if (b.priority === "urgent" && a.priority !== "urgent") return 1;
      return (statusWeight[b.status] || 0) - (statusWeight[a.status] || 0);
    });

    const activeInsights: DeliveryCopilotInsight[] = sortedActive.map((req, idx) => ({
      severity: req.priority === "urgent" ? "critical" : req.priority === "high" ? "high" : "info",
      title: `Step #${idx + 1}: Order #${req.orderId} [${req.status.toUpperCase()}]`,
      description: `Pickup: ${req.pickupAddress || "Seller Location"} ➔ Delivery: ${req.deliveryAddress || "Customer Location"}. Fee: ৳${req.deliveryFee || 60}`,
      evidence: [
        { fact: "Suggested Sequence", value: `Step #${idx + 1} (${req.priority} priority)` },
        { fact: "Lifecycle Stage", value: req.status.replace(/_/g, " ") },
        { fact: "Package Weight", value: req.packageInfo?.weight ? `${req.packageInfo.weight}kg` : "Standard parcel" },
        { fact: "Delivery OTP", value: req.deliveryOtp ? "Generated" : "Pending Pickup" },
      ],
    }));

    sections.push({
      title: "Current Active Deliveries (Suggested Sequence)",
      insights: activeInsights,
      data: { activeRequestsCount: activeRequests.length },
    });
  }

  // 3. Open Marketplace Deliveries with Capacity Matching
  if (availableRequests.length > 0) {
    const marketplaceInsights: DeliveryCopilotInsight[] = availableRequests.map((req) => {
      const pWeight = req.packageInfo?.weight || 0;
      const fitsWeight = pWeight === 0 || pWeight <= remainingWeightCapacity;
      const fitsParcels = currentActiveCount < maxParcels;
      const fitsCapacity = fitsWeight && fitsParcels;

      return {
        severity: req.priority === "urgent" ? "high" : "info",
        title: `Available Order #${req.orderId} (৳${req.deliveryFee || 60})`,
        description: `From: ${req.pickupAddress || "Seller"} ➔ To: ${req.deliveryAddress || "Customer"}. ${
          fitsCapacity ? "✅ Fits your vehicle capacity" : "⚠️ May exceed current capacity"
        }`,
        evidence: [
          { fact: "Package Weight", value: pWeight > 0 ? `${pWeight}kg` : "Weight not specified" },
          { fact: "Capacity Status", value: fitsCapacity ? "Eligible" : "Capacity Limited" },
          { fact: "Priority", value: req.priority },
        ],
      };
    });

    sections.push({
      title: "Open Marketplace Opportunities & Capacity Fit",
      insights: marketplaceInsights,
      data: { availableRequestsCount: availableRequests.length },
    });
  }

  // 4. Open Incidents & Delivery Risks
  if (incidents.length > 0) {
    sections.push({
      title: "Active Reported Incidents & Exceptions",
      insights: incidents.map((inc) => ({
        severity: inc.severity,
        title: `Incident on Order #${inc.orderId}: ${inc.category.replace(/_/g, " ")}`,
        description: inc.description,
      })),
    });
  }

  return {
    intent,
    timeRange,
    sections,
    sources,
  };
}
