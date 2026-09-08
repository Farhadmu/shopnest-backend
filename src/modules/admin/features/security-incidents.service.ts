import { Request } from "express";
import mongoose, { Types } from "mongoose";
import { SecurityIncident, ISecurityIncident, IncidentStatus, IncidentSeverity, IncidentType, IncidentSource } from "../../security/security-incident.model";
import { SecurityLog } from "../../security/securityLog.model";
import { AnomalyLog } from "../admin-intelligence.model";
import { AuditLog } from "../../security/auditLog.model";
import { createNotification } from "../../notifications/notification.service";
import { logSecurityEvent } from "../../security/security.service";

interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string; role: "customer" | "seller" | "admin" };
}

interface AdminInfo {
  id: string;
  name: string;
}

function getAdminInfo(req: AuthedRequest): AdminInfo {
  return {
    id: req.user?.id || "unknown",
    name: req.user?.name || "Administrator",
  };
}

const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  new: ["open", "acknowledged", "investigating", "resolved", "dismissed", "closed"],
  open: ["acknowledged", "investigating", "resolved", "dismissed", "closed"],
  acknowledged: ["investigating", "resolved", "dismissed", "closed"],
  investigating: ["mitigated", "resolved", "dismissed", "closed"],
  mitigated: ["resolved", "closed", "reopened"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  dismissed: ["reopened"],
  reopened: ["investigating", "resolved", "closed", "dismissed"],
};

export function isValidStatusTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  if (allowed && allowed.includes(to)) return true;
  const allowedReopen = VALID_TRANSITIONS["reopened"];
  if (allowedReopen && (to === "reopened" || allowedReopen.includes(to))) return true;
  return false;
}

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  suspicious_login: "Suspicious Login",
  account_takeover: "Account Takeover",
  authentication_anomaly: "Authentication Anomaly",
  api_abuse: "API Abuse",
  rate_limit_abuse: "Rate Limit Abuse",
  payment_security_anomaly: "Payment Security Anomaly",
  fraud_pattern: "Fraud Pattern",
  seller_security_incident: "Seller Security Incident",
  suspicious_order_activity: "Suspicious Order Activity",
  session_anomaly: "Session Anomaly",
  data_access_anomaly: "Data Access Anomaly",
  system_security_incident: "System Security Incident",
  other: "Other",
};

export const SEVERITY_ORDER: IncidentSeverity[] = ["low", "medium", "high", "critical"];

export function severityToRiskScore(severity: IncidentSeverity): number {
  const map: Record<IncidentSeverity, number> = {
    low: 30,
    medium: 50,
    high: 75,
    critical: 90,
  };
  return map[severity];
}

export async function getIncidentStats() {
  const [total, openCount, investigating, mitigated, resolved, closed, dismissed, critical, high, medium] = await Promise.all([
    SecurityIncident.countDocuments({}),
    SecurityIncident.countDocuments({ status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] } }),
    SecurityIncident.countDocuments({ status: "investigating" }),
    SecurityIncident.countDocuments({ status: "mitigated" }),
    SecurityIncident.countDocuments({ status: "resolved" }),
    SecurityIncident.countDocuments({ status: "closed" }),
    SecurityIncident.countDocuments({ status: "dismissed" }),
    SecurityIncident.countDocuments({ severity: "critical", status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] } }),
    SecurityIncident.countDocuments({ severity: "high", status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] } }),
    SecurityIncident.countDocuments({ severity: "medium", status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] } }),
  ]);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todayCreated, weekCreated, monthResolved, avgResolutionMs] = await Promise.all([
    SecurityIncident.countDocuments({ createdAt: { $gte: todayStart } }),
    SecurityIncident.countDocuments({ createdAt: { $gte: weekStart } }),
    SecurityIncident.countDocuments({ status: "resolved", resolvedAt: { $gte: thirtyDaysAgo } }),
    SecurityIncident.aggregate([
      { $match: { resolvedAt: { $exists: true, $ne: null }, detectedAt: { $exists: true, $ne: null } } },
      { $project: { duration: { $subtract: ["$resolvedAt", "$detectedAt"] } } },
      { $group: { _id: null, avgMs: { $avg: "$duration" } } },
    ]),
  ]);

  const avgResolutionHours = avgResolutionMs[0]?.avgMs && avgResolutionMs[0].avgMs > 0
    ? Math.round(avgResolutionMs[0].avgMs / (1000 * 3600))
    : null;

  return {
    total,
    open: openCount,
    investigating,
    mitigated,
    resolved,
    closed,
    dismissed,
    bySeverity: { critical, high, medium, low: total - critical - high - medium },
    todayCreated,
    weekCreated,
    monthResolved,
    avgResolutionHours,
  };
}

export interface IncidentQueryParams {
  status?: string;
  severity?: string;
  type?: string;
  source?: string;
  assignedTo?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
  limit?: string;
}

export async function fetchIncidents(params: IncidentQueryParams) {
  const {
    status,
    severity,
    type,
    source,
    assignedTo,
    search,
    sortBy = "createdAt",
    sortDir = "-1",
    page = "1",
    limit = "20",
  } = params;

  const skip = (Number(page) - 1) * Number(limit);
  const filter: Record<string, unknown> = {};

  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (type) filter.type = type;
  if (source) filter.source = source;
  if (assignedTo) filter["assignedAdmin.adminId"] = assignedTo;

  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { incidentCode: regex },
      { title: regex },
      { description: regex },
      { entityName: regex },
      { entityId: regex },
      { signals: { $elemMatch: { $regex: search, $options: "i" } } },
    ];
  }

  const sortField = ["severity", "riskScore", "createdAt", "updatedAt"].includes(sortBy) ? sortBy : "createdAt";
  const sortOrder = sortDir === "1" ? 1 : -1;

  const sortObj: Record<string, 1 | -1> = { [sortField]: sortOrder };
  if (sortField !== "createdAt") sortObj.createdAt = -1;

  const [incidents, total] = await Promise.all([
    SecurityIncident.find(filter).sort(sortObj).skip(skip).limit(Number(limit)),
    SecurityIncident.countDocuments(filter),
  ]);

  const typedIncidents = incidents as ISecurityIncident[];

  return {
    incidents: typedIncidents.map((i) => mapIncidentForList(i)),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
}

export async function fetchIncidentById(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const incident = await SecurityIncident.findById(id)
    .populate("relatedSecurityEvents")
    .populate("relatedRiskSignals");

  if (!incident) return null;

  const typedIncident = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  return mapIncidentForDetail(typedIncident);
}

interface CreateIncidentInput {
  title: string;
  description?: string;
  type?: IncidentType;
  source?: IncidentSource;
  entityType: ISecurityIncident["entityType"];
  entityId: string;
  entityName: string;
  severity?: IncidentSeverity;
  riskScore?: number;
  signals?: string[];
  evidence?: { description: string; reference: string }[];
  relatedSecurityEvents?: string[];
  relatedRiskSignals?: string[];
  detectedAt?: Date;
}

export async function createIncident(input: CreateIncidentInput, admin: AdminInfo) {
  const code = await generateIncidentCode();

  const incident = await SecurityIncident.create({
    incidentCode: code,
    title: input.title,
    description: input.description || "",
    type: input.type || "other",
    source: input.source || "manual",
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    severity: input.severity || "medium",
    status: "new",
    riskScore: input.riskScore !== undefined ? input.riskScore : severityToRiskScore(input.severity || "medium"),
    signals: input.signals || [],
    detectedAt: input.detectedAt || new Date(),
    evidence: input.evidence || [],
    relatedSecurityEvents: input.relatedSecurityEvents || [],
    relatedRiskSignals: input.relatedRiskSignals || [],
    history: [{
      action: "INCIDENT_CREATED",
      changedBy: admin.name,
      timestamp: new Date(),
      details: `Incident created via ${input.source || "manual"}.`,
    }],
  });

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_CREATED",
    resource: "SecurityIncident",
    resourceId: String(incident._id),
    status: "success",
    details: { incidentCode: incident.incidentCode, title: incident.title, severity: incident.severity },
  });

  if (incident.severity === "high" || incident.severity === "critical") {
    await notifyAdminsOfIncident(incident, admin);
  }

  return incident.toJSON();
}

export async function updateIncidentStatus(id: string, status: IncidentStatus, notes: string | undefined, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const currentStatus = typed.status as IncidentStatus;

  if (!isValidStatusTransition(currentStatus, status)) {
    throw { statusCode: 400, message: `Invalid status transition: ${currentStatus} -> ${status}` };
  }

  const update: Record<string, unknown> = { status };
  const now = new Date();

  if (status === "acknowledged" && !typed.acknowledgedAt) {
    update.acknowledgedAt = now;
  }
  if (status === "investigating" && !typed.investigationStartedAt) {
    update.investigationStartedAt = now;
  }
  if (status === "mitigated") {
    update.mitigatedAt = now;
    update.mitigatedBy = admin.name;
  }
  if (status === "resolved") {
    update.resolvedAt = now;
    update.resolvedBy = admin.name;
  }
  if (status === "closed") {
    update.closedAt = now;
    update.closedBy = admin.name;
  }

  const historyEntry: any = {
    action: "STATUS_CHANGED",
    changedBy: admin.name,
    timestamp: now,
    details: `Status changed from ${currentStatus} to ${status}`,
  };
  if (notes) {
    historyEntry.details += `. Note: ${notes}`;
  }

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      ...update,
      $push: {
        history: historyEntry,
        ...(notes
          ? {
              notes: {
                authorId: admin.id,
                authorName: admin.name,
                note: notes,
                createdAt: now,
              },
            }
          : {}),
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: `INCIDENT_${status.toUpperCase()}`,
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      previousStatus: currentStatus,
      newStatus: status,
      notes: notes || undefined,
    },
  });

  await logSecurityEvent("ADMIN_ACTION", `Incident ${typed.incidentCode} status changed to ${status}`, {
    userId: admin.id,
    details: { incidentId: String(typed._id), status, previousStatus: currentStatus },
  });

  if (!updated) throw new Error("Failed to update incident");
  return updated!.toJSON();
}

export async function updateIncidentSeverity(id: string, severity: IncidentSeverity, reason: string | undefined, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const oldSeverity = typed.severity as IncidentSeverity;

  if (oldSeverity === severity) {
    return incident.toJSON();
  }

  const now = new Date();
  const riskScore = severityToRiskScore(severity);

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      severity,
      riskScore,
      $push: {
        history: {
          action: "SEVERITY_CHANGED",
          changedBy: admin.name,
          timestamp: now,
          details: `Severity changed from ${oldSeverity} to ${severity}. ${reason ? `Reason: ${reason}` : ""}`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_SEVERITY_CHANGED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      previousSeverity: oldSeverity,
      newSeverity: severity,
      reason: reason || undefined,
    },
  });

  if ((severity === "high" || severity === "critical") && typed.severity !== "high" && typed.severity !== "critical") {
    await notifyAdminsOfIncident(typed as any, admin);
  }

  return updated!.toJSON();
}

export async function assignIncident(id: string, adminId: string, adminName: string, assigner: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const previousAssignees = typed.assignedAdmin ? [typed.assignedAdmin.adminName] : [];
  const action = typed.assignedAdmin ? "ADMIN_REASSIGNED" : "ADMIN_ASSIGNED";

  const now = new Date();
  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      assignedAdmin: {
        adminId,
        adminName,
        assignedAt: now,
      },
      $push: {
        history: {
          action,
          changedBy: assigner.name,
          timestamp: now,
          details: `Admin ${adminName} assigned. Previous: ${previousAssignees.join(", ") || "unassigned"}`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: assigner.id,
    actorName: assigner.name,
    role: "admin",
    action: action,
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      assignedTo: adminName,
      previousAssignees,
    },
  });

  return updated!.toJSON();
}

export async function unassignIncident(id: string, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const previousAssignee = typed.assignedAdmin ? typed.assignedAdmin.adminName : "none";
  const now = new Date();

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      $unset: { assignedAdmin: 1 },
      $push: {
        history: {
          action: "ADMIN_UNASSIGNED",
          changedBy: admin.name,
          timestamp: now,
          details: `Admin ${previousAssignee} unassigned.`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_UNASSIGNED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      previouslyAssigned: previousAssignee,
    },
  });

  return updated!.toJSON();
}

export async function addIncidentNote(id: string, note: string, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const now = new Date();

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      $push: {
        notes: {
          authorId: admin.id,
          authorName: admin.name,
          note,
          createdAt: now,
        },
        history: {
          action: "NOTE_ADDED",
          changedBy: admin.name,
          timestamp: now,
          details: note.substring(0, 200),
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_NOTE_ADDED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: { incidentCode: typed.incidentCode },
  });

  return updated!.toJSON();
}

export async function addEvidence(id: string, description: string, reference: string, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const now = new Date();

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      $push: {
        evidence: {
          description,
          reference,
          addedBy: admin.name,
          addedAt: now,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_EVIDENCE_ADDED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: { incidentCode: typed.incidentCode, reference },
  });

  return updated!.toJSON();
}

export async function resolveIncident(id: string, resolutionSummary: string, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const currentStatus = typed.status as IncidentStatus;
  const now = new Date();

  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      status: "resolved",
      resolvedAt: now,
      resolvedBy: admin.name,
      resolutionSummary,
      $push: {
        history: {
          action: "INCIDENT_RESOLVED",
          changedBy: admin.name,
          timestamp: now,
          details: `Incident resolved. Resolution: ${resolutionSummary.substring(0, 200)}`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_RESOLVED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      previousStatus: currentStatus,
      resolutionSummary: resolutionSummary.substring(0, 500),
    },
  });

  await logSecurityEvent("ADMIN_ACTION", `Incident ${typed.incidentCode} resolved`, {
    userId: admin.id,
    details: { incidentId: String(typed._id) },
  });

  return updated!.toJSON();
}

export async function closeIncident(id: string, closeReason: string, admin: AdminInfo) {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const currentStatus = typed.status as IncidentStatus;

  if (currentStatus !== "resolved") {
    throw { statusCode: 400, message: `Can only close resolved incidents. Current status: ${currentStatus}` };
  }

  const now = new Date();
  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      status: "closed",
      closedAt: now,
      closedBy: admin.name,
      closeReason,
      $push: {
        history: {
          action: "INCIDENT_CLOSED",
          changedBy: admin.name,
          timestamp: now,
          details: `Incident closed. Reason: ${closeReason.substring(0, 200)}`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_CLOSED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      closeReason: closeReason.substring(0, 500),
    },
  });

  return updated!.toJSON();
}

export async function reopenIncident(id: string, reason: string, admin: AdminInfo, targetStatus: "open" | "investigating" = "investigating") {
  const incident = await SecurityIncident.findById(id);
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };
  const currentStatus = typed.status as IncidentStatus;

  const reopenableStatuses = ["resolved", "closed", "dismissed", "mitigated"];
  if (!reopenableStatuses.includes(currentStatus)) {
    throw { statusCode: 400, message: `Cannot reopen incident with status: ${currentStatus}` };
  }

  const now = new Date();
  const updated = await SecurityIncident.findByIdAndUpdate(
    id,
    {
      status: targetStatus,
      ...(targetStatus === "investigating" && !typed.investigationStartedAt
        ? { investigationStartedAt: now }
        : {}),
      $push: {
        history: {
          action: "INCIDENT_REOPENED",
          changedBy: admin.name,
          timestamp: now,
          details: `Incident reopened. Reason: ${reason.substring(0, 200)}. New status: ${targetStatus}`,
        },
      },
    },
    { new: true }
  );

  await AuditLog.create({
    actorId: admin.id,
    actorName: admin.name,
    role: "admin",
    action: "INCIDENT_REOPENED",
    resource: "SecurityIncident",
    resourceId: String(typed._id),
    status: "success",
    details: {
      incidentCode: typed.incidentCode,
      previousStatus: currentStatus,
      reason: reason.substring(0, 500),
      newStatus: targetStatus,
    },
  });

  await logSecurityEvent("ADMIN_ACTION", `Incident ${typed.incidentCode} reopened`, {
    userId: admin.id,
    details: { incidentId: String(typed._id), reason },
  });

  return updated!.toJSON();
}

export async function getIncidentTimeline(id: string) {
  const incident = await SecurityIncident.findById(id).select("history createdAt updatedAt detectedAt acknowledgedAt investigationStartedAt mitigatedAt resolvedAt closedAt");
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };

  const events: { action: string; actor: string; timestamp: Date | null; details?: string }[] = [];

  events.push({
    action: "INCIDENT_CREATED",
    actor: "System",
    timestamp: typed.detectedAt || typed.createdAt,
    details: typed.source,
  });

  if (typed.acknowledgedAt) {
    events.push({ action: "ACKNOWLEDGED", actor: "", timestamp: typed.acknowledgedAt });
  }
  if (typed.investigationStartedAt) {
    events.push({ action: "INVESTIGATION_STARTED", actor: "", timestamp: typed.investigationStartedAt || null });
  }
  if (typed.mitigatedAt) {
    events.push({ action: "MITIGATED", actor: typed.mitigatedBy || "", timestamp: typed.mitigatedAt });
  }
  if (typed.resolvedAt) {
    events.push({ action: "RESOLVED", actor: typed.resolvedBy || "", timestamp: typed.resolvedAt });
  }
  if (typed.closedAt) {
    events.push({ action: "CLOSED", actor: typed.closedBy || "", timestamp: typed.closedAt });
  }

  for (const h of typed.history) {
    events.push({
      action: h.action,
      actor: h.changedBy,
      timestamp: h.timestamp,
      details: h.details,
    });
  }

  events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  return events.map((e, idx) => ({
    id: `${e.action}-${idx}`,
    action: e.action,
    actor: e.actor,
    timestamp: e.timestamp,
    details: e.details,
  }));
}

export async function getRelatedSecurityEvents(id: string) {
  const incident = await SecurityIncident.findById(id).select("relatedSecurityEvents");
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };

  if (!typed.relatedSecurityEvents || typed.relatedSecurityEvents.length === 0) {
    return [];
  }

  const events = await SecurityLog.find({ _id: { $in: typed.relatedSecurityEvents } }).sort({ createdAt: -1 });

  return events.map((e) => ({
    id: e._id.toString(),
    type: e.type,
    severity: e.severity,
    userId: e.userId,
    ip: e.ip,
    message: e.message,
    details: e.details,
    resolved: e.resolved,
    timestamp: e.createdAt,
  }));
}

export async function getRelatedRiskSignals(id: string) {
  const incident = await SecurityIncident.findById(id).select("relatedRiskSignals");
  if (!incident) {
    throw { statusCode: 404, message: "Incident not found" };
  }

  const typed = incident as unknown as ISecurityIncident & { _id: Types.ObjectId };

  if (!typed.relatedRiskSignals || typed.relatedRiskSignals.length === 0) {
    return [];
  }

  const signals = await AnomalyLog.find({ _id: { $in: typed.relatedRiskSignals } }).sort({ detectedAt: -1 });

  return signals.map((a) => ({
    id: a._id.toString(),
    entityType: a.entityType,
    entityName: a.entityName,
    anomalyType: a.anomalyType,
    severity: a.severity,
    riskScore: a.riskScore,
    evidence: a.evidence,
    recommendedAction: a.recommendedAction,
    status: a.status,
    detectedAt: a.detectedAt,
  }));
}

async function generateIncidentCode(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `INC-${year}-${month}`;

  const count = await SecurityIncident.countDocuments({
    incidentCode: { $regex: `^${prefix}-` },
  });

  const sequence = count + 1;
  const padded = String(sequence).padStart(4, "0");
  return `${prefix}-${padded}`;
}

async function notifyAdminsOfIncident(incident: any, triggerAdmin: AdminInfo) {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const adminUsers = await db.collection("user").find({ role: "admin" }).toArray();
    if (!adminUsers || adminUsers.length === 0) return;

    const incidentTyped = incident as unknown as ISecurityIncident;

    for (const adminUser of adminUsers) {
      const adminUserId = String(adminUser.id ?? adminUser._id);
      if (adminUserId === triggerAdmin.id) continue;

      await createNotification({
        userId: adminUserId,
        type: "seller_approval",
        title: `🚨 ${incident.severity.toUpperCase()} Security Incident Detected`,
        message: `Incident ${incident.incidentCode}: ${incident.title} has been flagged as ${incident.severity}. Review and take action.`,
        link: `/dashboard/admin/incidents`,
      });
    }
  } catch (err) {
    console.warn("Failed to notify admins of incident", err);
  }
}

export async function createIncidentFromSecurityLog(
  securityLog: any,
  severity: IncidentSeverity,
  type: IncidentType = "other",
  source: IncidentSource = "security_log"
) {
  const db = mongoose.connection.db;
  let entityName = "Unknown";
  let entityId = securityLog.userId || securityLog.ip || "unknown";
  let entityType: ISecurityIncident["entityType"] = "system";

  if (securityLog.userId && db) {
    entityType = "user";
    const user = await db.collection("user").findOne({ id: securityLog.userId });
    if (user) entityName = user.name || user.email || securityLog.userId;
  } else if (securityLog.ip) {
    entityType = "ip_cluster";
    entityName = securityLog.ip;
  }

  const existing = await SecurityIncident.findOne({
    entityId: String(entityId),
    type,
    status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] },
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });

  if (existing) {
    return existing.toJSON();
  }

  return createIncident(
    {
      title: securityLog.message,
      description: `Automatically created from ${securityLog.type} security event.`,
      type,
      source,
      entityType,
      entityId: String(entityId),
      entityName,
      severity,
      riskScore: severityToRiskScore(severity),
      signals: securityLog.details ? [JSON.stringify(securityLog.details)] : [],
      detectedAt: securityLog.createdAt,
    },
    { id: "system", name: "ShopNest Security Sentinel" }
  );
}

export async function autoCreateIncidentFromAnomaly(anomaly: any) {
  const severityMap: Record<string, IncidentSeverity> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
  };

  const typeMap: Record<string, IncidentType> = {
    unusual_order_spike: "suspicious_order_activity",
    review_velocity_surge: "fraud_pattern",
    cancellation_spike: "seller_security_incident",
    price_anomaly: "fraud_pattern",
    coupon_abuse_pattern: "fraud_pattern",
    refund_leakage: "payment_security_anomaly",
  };

  const existing = await SecurityIncident.findOne({
    entityId: String(anomaly.entityId),
    type: typeMap[anomaly.anomalyType] || "other",
    status: { $in: ["new", "open", "acknowledged", "investigating", "mitigated"] },
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });

  if (existing) {
    return existing.toJSON();
  }

  const adminInfo = { id: "system", name: "ShopNest Security Sentinel" };

  return createIncident(
    {
      title: anomaly.anomalyType.replace(/_/g, " ") + " — " + anomaly.entityName,
      description: anomaly.evidence,
      type: typeMap[anomaly.anomalyType] || "other",
      source: "anomaly",
      entityType: anomaly.entityType as ISecurityIncident["entityType"],
      entityId: String(anomaly.entityId),
      entityName: anomaly.entityName,
      severity: severityMap[anomaly.severity] || "medium",
      riskScore: anomaly.riskScore,
      signals: [anomaly.recommendedAction],
      relatedRiskSignals: [anomaly._id],
      detectedAt: anomaly.detectedAt,
    },
    adminInfo
  );
}

function mapIncidentForList(incident: ISecurityIncident & { _id: Types.ObjectId }) {
  return {
    id: incident._id.toString(),
    incidentCode: incident.incidentCode,
    title: incident.title,
    description: incident.description,
    type: incident.type,
    source: incident.source,
    entityType: incident.entityType,
    entityId: incident.entityId,
    entityName: incident.entityName,
    severity: incident.severity,
    status: incident.status,
    riskScore: incident.riskScore,
    signals: incident.signals,
    assignedAdmin: incident.assignedAdmin
      ? {
          adminId: incident.assignedAdmin.adminId,
          adminName: incident.assignedAdmin.adminName,
          assignedAt: incident.assignedAdmin.assignedAt,
        }
      : undefined,
    detectedAt: incident.detectedAt,
    acknowledgedAt: incident.acknowledgedAt,
    investigationStartedAt: incident.investigationStartedAt,
    mitigatedAt: incident.mitigatedAt,
    resolvedAt: incident.resolvedAt,
    closedAt: incident.closedAt,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

function mapIncidentForDetail(incident: ISecurityIncident & { _id: Types.ObjectId }) {
  const mapped = mapIncidentForList(incident);
  return {
    ...mapped,
    notes: incident.notes,
    history: incident.history,
    evidence: incident.evidence,
    relatedSecurityEvents: incident.relatedSecurityEvents?.map((id) => id.toString()) || [],
    relatedRiskSignals: incident.relatedRiskSignals?.map((id) => id.toString()) || [],
    resolutionSummary: incident.resolutionSummary,
    closeReason: incident.closeReason,
    mitigatedBy: incident.mitigatedBy,
    resolvedBy: incident.resolvedBy,
    closedBy: incident.closedBy,
  };
}
