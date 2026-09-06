import { Request, Response } from "express";
import { asyncHandler } from "../../../../utils/async-handler";
import { sendSuccess } from "../../../../utils/api-response";
import { ApiError } from "../../../../utils/api-error";
import { SecurityIncident } from "../../../security/security-incident.model";
import { AuditLog } from "../../../security/auditLog.model";

// 8. SECURITY INCIDENTS
export const getSecurityIncidents = asyncHandler(async (req: Request, res: Response) => {
  const { status, severity, page = 1, limit = 20 } = req.query as {
    status?: string; severity?: string; page?: string; limit?: string;
  };

  const skip = (Number(page) - 1) * Number(limit);
  const filter: any = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;

  const [incidents, total, openCount, investigatingCount, resolvedCount, criticalCount] = await Promise.all([
    SecurityIncident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    SecurityIncident.countDocuments(filter),
    SecurityIncident.countDocuments({ status: { $in: ["new", "investigating"] } }),
    SecurityIncident.countDocuments({ status: "investigating" }),
    SecurityIncident.countDocuments({ status: "resolved" }),
    SecurityIncident.countDocuments({ severity: "critical", status: { $in: ["new", "investigating"] } }),
  ]);

  sendSuccess(res, {
    incidents: incidents.map((i) => ({
      id: i._id,
      incidentCode: i.incidentCode,
      title: i.title,
      entityType: i.entityType,
      entityName: i.entityName,
      severity: i.severity,
      status: i.status,
      riskScore: i.riskScore,
      signals: i.signals,
      notes: i.notes,
      history: i.history,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
    })),
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    stats: { total, open: openCount, investigating: investigatingCount, resolved: resolvedCount, critical: criticalCount },
  });
});

// Update incident status
export const updateIncidentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ["new", "investigating", "resolved", "dismissed"];
  if (!validStatuses.includes(status)) throw ApiError.badRequest("Invalid status");

  const incident = await SecurityIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");

  const update: any = { status };
  if (status === "resolved") update.resolvedAt = new Date();
  if (notes) {
    update.$push = { notes: { authorId: req.user?.id, authorName: req.user?.name, note: notes, createdAt: new Date() } };
  }

  const updated = await SecurityIncident.findByIdAndUpdate(id, update, { new: true });

  await AuditLog.create({
    actorId: req.user?.id || "system",
    actorName: req.user?.name || "Admin",
    role: "admin",
    action: `INCIDENT_${status.toUpperCase()}`,
    resource: "SecurityIncident",
    resourceId: id,
    status: "success",
    details: { previousStatus: incident.status, notes },
  });

  sendSuccess(res, updated, `Incident ${status}`);
});
