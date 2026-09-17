import mongoose, { Types } from "mongoose";
import { SecurityIncident, ISecurityIncident, IncidentStatus, IncidentSeverity, IncidentType, IncidentSource } from "../security/security-incident.model";
import { createNotification } from "../notifications/notification.service";
import { AuditLog } from "../security/auditLog.model";
import { logSecurityEvent } from "../security/security.service";

export interface ComplaintAuthor {
  id: string;
  name: string;
  role: "customer" | "seller" | "delivery_man";
}

export interface CreateComplaintInput {
  title: string;
  description: string;
  category: string;
  author: ComplaintAuthor;
  orderId?: string;
  productId?: string;
  deliveryId?: string;
  sellerId?: string;
  attachments?: string[];
}

export interface ComplaintListItem {
  id: string;
  incidentCode: string;
  title: string;
  description: string;
  category: string;
  source: IncidentSource;
  status: IncidentStatus;
  severity: IncidentSeverity;
  assignedAdmin?: { adminId: string; adminName: string; assignedAt: Date } | undefined;
  createdAt: Date;
  updatedAt: Date;
  orderId?: string;
  productId?: string;
  deliveryId?: string;
  sellerId?: string;
  attachments: string[];
}

export interface ComplaintDetail extends ComplaintListItem {
  entityId: string;
  entityName: string;
  notes: { authorId: string; authorName: string; note: string; createdAt: Date }[];
  history: { action: string; changedBy: string; timestamp: Date; details?: string }[];
  evidence: { description: string; reference: string; addedBy: string; addedAt: Date }[];
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionSummary?: string;
  closedAt?: Date;
  closedBy?: string;
  closeReason?: string;
}

const COMPLAINT_TYPE_LABELS: Record<string, string> = {
  complaint_order: "Order",
  complaint_payment: "Payment",
  complaint_product: "Product",
  complaint_seller: "Seller",
  complaint_delivery: "Delivery",
  complaint_refund: "Refund",
  complaint_return: "Return",
  complaint_account: "Account",
  complaint_technical: "Technical",
  complaint_other: "Other",
};

const COMPLAINT_TYPE_MAP: Record<string, IncidentType> = {
  order: "complaint_order",
  payment: "complaint_payment",
  product: "complaint_product",
  seller: "complaint_seller",
  delivery: "complaint_delivery",
  refund: "complaint_refund",
  return: "complaint_return",
  account: "complaint_account",
  technical: "complaint_technical",
  other: "complaint_other",
};

function normalizeCategory(category: string): IncidentType {
  const key = category.toLowerCase().replace(/\s+/g, "_");
  return COMPLAINT_TYPE_MAP[key] || "complaint_other";
}

function toSource(role: ComplaintAuthor["role"]): IncidentSource {
  if (role === "delivery_man") return "delivery_man";
  if (role === "seller") return "seller";
  return "customer";
}

export async function createComplaint(input: CreateComplaintInput): Promise<ComplaintDetail> {
  const source = toSource(input.author.role);
  const type = normalizeCategory(input.category);
  const now = new Date();
  const incident = await SecurityIncident.create({
    incidentCode: await generateComplaintCode(),
    title: input.title,
    description: input.description,
    type,
    source,
    entityType: input.author.role === "seller" ? "seller" : "user",
    entityId: input.author.id,
    entityName: input.author.name,
    severity: "medium",
    status: "new",
    riskScore: 50,
    signals: [],
    detectedAt: now,
    orderId: input.orderId,
    productId: input.productId,
    deliveryId: input.deliveryId,
    sellerId: input.sellerId,
    attachments: input.attachments || [],
    history: [
      {
        action: "INCIDENT_CREATED",
        changedBy: input.author.name,
        timestamp: now,
        details: `Complaint submitted by ${input.author.role}: ${input.category}`,
      },
    ],
  });

  await AuditLog.create({
    actorId: input.author.id,
    actorName: input.author.name,
    role: input.author.role,
    action: "COMPLAINT_CREATED",
    resource: "SecurityIncident",
    resourceId: String(incident._id),
    status: "success",
    details: {
      incidentCode: incident.incidentCode,
      category: input.category,
      source,
      orderId: input.orderId || undefined,
      productId: input.productId || undefined,
      deliveryId: input.deliveryId || undefined,
      sellerId: input.sellerId || undefined,
    },
  });

  await createAdminComplaintNotification(incident, input.author);

  return mapComplaintDetail(incident as unknown as ISecurityIncident & { _id: Types.ObjectId });
}

export async function getMyComplaints(authorId: string, source: IncidentSource): Promise<{ items: ComplaintListItem[]; total: number }> {
  const filter: Record<string, unknown> = {
    source,
    entityId: authorId,
  };

  const [items, total] = await Promise.all([
    SecurityIncident.find(filter).sort({ createdAt: -1 }).lean(),
    SecurityIncident.countDocuments(filter),
  ]);

  return {
    items: items.map((i: any) => mapComplaintListItem(i as any)),
    total,
  };
}

export async function getMyComplaintById(id: string, authorId: string, source: IncidentSource): Promise<ComplaintDetail | null> {
  const incident = await SecurityIncident.findOne({ _id: id, source, entityId: authorId }).lean();
  if (!incident) return null;
  return mapComplaintDetail(incident as unknown as ISecurityIncident & { _id: Types.ObjectId });
}

export async function getAdminComplaints(params: {
  source?: string;
  status?: string;
  type?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { source, status, type, search, page = 1, limit = 20 } = params;
  const skip = (Number(page) - 1) * Number(limit);
  const filter: Record<string, unknown> = {};

  if (source && source !== "all") {
    filter.source = source;
  }
  if (status) {
    filter.status = status;
  }
  if (type) {
    filter.type = type;
  }
  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { incidentCode: regex },
      { title: regex },
      { description: regex },
      { entityName: regex },
      { entityId: regex },
    ];
  }

  const [items, total] = await Promise.all([
    SecurityIncident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    SecurityIncident.countDocuments(filter),
  ]);

  return {
    items: items.map((i: any) => mapComplaintListItem(i as any)),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
}

export async function getAdminComplaintStats() {
  const [total, customer, deliveryMan, seller, open, inReview, resolved] = await Promise.all([
    SecurityIncident.countDocuments({ source: { $in: ["customer", "delivery_man", "seller"] } }),
    SecurityIncident.countDocuments({ source: "customer" }),
    SecurityIncident.countDocuments({ source: "delivery_man" }),
    SecurityIncident.countDocuments({ source: "seller" }),
    SecurityIncident.countDocuments({ source: { $in: ["customer", "delivery_man", "seller"] }, status: { $in: ["new", "open", "acknowledged", "investigating"] } }),
    SecurityIncident.countDocuments({ source: { $in: ["customer", "delivery_man", "seller"] }, status: "investigating" }),
    SecurityIncident.countDocuments({ source: { $in: ["customer", "delivery_man", "seller"] }, status: "resolved" }),
  ]);

  return { total, customer, deliveryMan, seller, open: open, inReview, resolved };
}

async function generateComplaintCode(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `CMP-${year}-${month}`;

  const count = await SecurityIncident.countDocuments({ incidentCode: { $regex: `^${prefix}-` } });
  const sequence = count + 1;
  const padded = String(sequence).padStart(4, "0");
  return `${prefix}-${padded}`;
}

async function createAdminComplaintNotification(incident: any, author: ComplaintAuthor) {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const adminUsers = await db.collection("user").find({ role: "admin" }).toArray();
    if (!adminUsers || adminUsers.length === 0) return;

    const categoryLabel = COMPLAINT_TYPE_LABELS[incident.type] || "Complaint";
    for (const adminUser of adminUsers) {
      const adminUserId = String(adminUser.id ?? adminUser._id);
      await createNotification({
        userId: adminUserId,
        recipientType: "admin",
        type: "incident_alert",
        category: "incidents",
        priority: "info",
        source: "incident",
        title: `New ${categoryLabel} complaint`,
        message: `${author.name} submitted a ${categoryLabel} complaint: ${incident.title}`,
        link: `/dashboard/admin/incidents`,
        relatedId: incident._id?.toString(),
        relatedType: "incident",
      });
    }
  } catch (err) {
    console.warn("Failed to notify admins of complaint", err);
  }
}

function mapComplaintListItem(incident: any): ComplaintListItem {
  return {
    id: incident._id?.toString() || incident.id,
    incidentCode: incident.incidentCode,
    title: incident.title,
    description: incident.description,
    category: incident.type,
    source: incident.source,
    status: incident.status,
    severity: incident.severity,
    assignedAdmin: incident.assignedAdmin,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    orderId: incident.orderId,
    productId: incident.productId,
    deliveryId: incident.deliveryId,
    sellerId: incident.sellerId,
    attachments: incident.attachments || [],
  };
}

function mapComplaintDetail(incident: ISecurityIncident & { _id: Types.ObjectId }): ComplaintDetail {
  const mapped = mapComplaintListItem(incident);
  return {
    ...mapped,
    entityId: incident.entityId,
    entityName: incident.entityName,
    notes: incident.notes || [],
    history: incident.history || [],
    evidence: incident.evidence || [],
    resolvedAt: incident.resolvedAt,
    resolvedBy: incident.resolvedBy,
    resolutionSummary: incident.resolutionSummary,
    closedAt: incident.closedAt,
    closedBy: incident.closedBy,
    closeReason: incident.closeReason,
  };
}
