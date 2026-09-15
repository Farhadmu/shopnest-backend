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

  const maxCapacity = details?.preferences?.maxActiveDeliveries ?? details?.vehicle?.vehicleCapacity ?? 3;
  const currentActiveCount = activeRequests.length;
  const todayEarnings = completedDeliveries.reduce((sum, d) => sum + (d.deliveryFee || 60), 0);

  // 1. Rider Operational Status
  const statusMetrics: DeliveryCopilotMetric[] = [
    {
      label: "Active Deliveries",
      value: currentActiveCount,
      formatted: `${currentActiveCount} / ${maxCapacity}`,
    },
    {
      label: "Today's Completed",
      value: completedDeliveries.length,
      formatted: `${completedDeliveries.length} orders`,
    },
    {
      label: "Today's Estimated Earnings",
      value: todayEarnings,
      formatted: `৳${todayEarnings}`,
    },
    {
      label: "Customer Rating",
      value: details?.rating || 5.0,
      formatted: `${(details?.rating || 5.0).toFixed(1)} ★ (${details?.ratingCount || 0} ratings)`,
    },
    {
      label: "Vehicle Type",
      value: 1,
      formatted: `${details?.vehicle?.vehicleType || "Motorcycle"} (${details?.vehicle?.vehicleModel || "Standard"})`,
    },
  ];

  sections.push({
    title: "Rider Live Operational State",
    metrics: statusMetrics,
    data: {
      isApproved: profile?.status === "approved",
      availability: details?.availabilityStatus || "offline",
      vehicle: details?.vehicle,
      preferredZones: details?.personal?.serviceArea || details?.preferences?.preferredServiceZones || [],
    },
  });

  // 2. Active Deliveries Breakdown
  if (activeRequests.length > 0) {
    const activeInsights: DeliveryCopilotInsight[] = activeRequests.map((req, idx) => ({
      severity: req.priority === "urgent" ? "critical" : req.priority === "high" ? "high" : "info",
      title: `Order #${req.orderId} [${req.status.toUpperCase()}]`,
      description: `Pickup: ${req.pickupAddress || "Seller Location"} ➔ Delivery: ${req.deliveryAddress || "Customer Location"}. Fee: ৳${req.deliveryFee || 60}`,
      evidence: [
        { fact: "Sequence Priority", value: `#${idx + 1} (${req.priority})` },
        { fact: "Current Status", value: req.status },
        { fact: "Delivery OTP", value: req.deliveryOtp ? "Generated" : "Pending" },
      ],
    }));

    sections.push({
      title: "Current Active Deliveries in Progress",
      insights: activeInsights,
      data: { activeRequests },
    });
  }

  // 3. Open Marketplace Deliveries Available to Accept
  if (availableRequests.length > 0) {
    const marketplaceInsights: DeliveryCopilotInsight[] = availableRequests.map((req) => ({
      severity: req.priority === "urgent" ? "high" : "info",
      title: `Available Order #${req.orderId} (৳${req.deliveryFee || 60})`,
      description: `From: ${req.pickupAddress || "Seller"} ➔ To: ${req.deliveryAddress || "Customer"}. Priority: ${req.priority}`,
      evidence: [
        { fact: "Est. Distance", value: req.estimatedDistance ? `${req.estimatedDistance} km` : "Standard City Zone" },
        { fact: "Package Info", value: req.packageInfo?.weight ? `${req.packageInfo.weight}kg` : "Standard parcel" },
      ],
    }));

    sections.push({
      title: "Open Deliveries in Marketplace",
      insights: marketplaceInsights,
      data: { availableRequestsCount: availableRequests.length },
    });
  }

  // 4. Open Incidents
  if (incidents.length > 0) {
    sections.push({
      title: "Active Reported Incidents",
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
