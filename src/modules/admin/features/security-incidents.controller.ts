import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { SecurityIncident } from "../../security/security-incident.model";
import { AuditLog } from "../../security/auditLog.model";

export const getSecurityIncidents = asyncHandler(async (req: Request, res: Response) => {
  const { status, severity } = req.query as { status?: string; severity?: string };
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;

  const incidents = await SecurityIncident.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, incidents);
});

export const updateSecurityIncident = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, severity, notes } = req.body;

  const incident = await SecurityIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");

  const adminName = (req.user as any)?.name || "Administrator";

  if (status && status !== incident.status) {
    incident.history.push({
      action: "STATUS_CHANGED",
      changedBy: adminName,
      timestamp: new Date(),
      details: `Status changed from ${incident.status} to ${status}`,
    });
    incident.status = status;
    if (status === "resolved" || status === "dismissed") {
      incident.resolvedAt = new Date();
      incident.resolvedBy = adminName;
    }
  }

  if (severity && severity !== incident.severity) {
    incident.history.push({
      action: "SEVERITY_CHANGED",
      changedBy: adminName,
      timestamp: new Date(),
      details: `Severity updated from ${incident.severity} to ${severity}`,
    });
    incident.severity = severity;
  }

  if (notes) {
    incident.notes.push({
      authorId: req.user?.id || "admin",
      authorName: adminName,
      note: String(notes),
      createdAt: new Date(),
    });
  }

  await incident.save();

  // Log to Audit Log
  await AuditLog.create({
    actorId: req.user?.id || "admin",
    actorName: adminName,
    role: "admin",
    action: `UPDATED_INCIDENT_${incident.incidentCode}`,
    resource: "SecurityIncident",
    resourceId: incident.id,
    status: "success",
    details: { incidentCode: incident.incidentCode, status: incident.status, severity: incident.severity },
  });

  sendSuccess(res, incident, "Incident updated successfully");
});

export const addIncidentNote = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body;
  if (!note) throw ApiError.badRequest("Note text is required");

  const incident = await SecurityIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");

  const adminName = (req.user as any)?.name || "Administrator";

  incident.notes.push({
    authorId: req.user?.id || "admin",
    authorName: adminName,
    note,
    createdAt: new Date(),
  });

  await incident.save();
  sendSuccess(res, incident, "Internal note added");
});

// 39. ADMIN AUDIT LOG