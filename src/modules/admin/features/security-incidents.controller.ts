import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { validate } from "../../../middlewares/validate.middleware";
import { ApiError } from "../../../utils/api-error";
import {
  fetchIncidents,
  fetchIncidentById,
  getIncidentStats,
  createIncident,
  updateIncidentStatus,
  updateIncidentSeverity,
  assignIncident,
  unassignIncident,
  addIncidentNote,
  addEvidence,
  resolveIncident,
  reopenIncident,
  closeIncident,
  getIncidentTimeline,
  getRelatedSecurityEvents,
  getRelatedRiskSignals,
  createIncidentFromSecurityLog,
  autoCreateIncidentFromAnomaly,
  IncidentQueryParams,
} from "./security-incidents.service";
import {
  incidentIdParamSchema,
  createIncidentSchema,
  incidentStatusSchema,
  incidentSeveritySchema,
  incidentAssignSchema,
  incidentNoteSchema,
  incidentEvidenceSchema,
  incidentResolveSchema,
  incidentReopenSchema,
  incidentCloseSchema,
  incidentQuerySchema,
} from "../../../schemas/incident.schema";
import { SecurityIncident } from "../../security/security-incident.model";
import { AnomalyLog } from "../../admin/admin-intelligence.model";
import { SecurityLog } from "../../security/securityLog.model";

interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string; role: "customer" | "seller" | "admin" };
}

function getAdminInfo(req: AuthedRequest) {
  return {
    id: req.user?.id || "unknown",
    name: req.user?.name || "Administrator",
  };
}

// 38. SECURITY INCIDENT MANAGEMENT

// GET /admin/incidents - List incidents with full filtering and pagination
export const getSecurityIncidents = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = incidentQuerySchema.parse(req.query) as unknown as IncidentQueryParams;
  const [result, stats] = await Promise.all([
    fetchIncidents(params),
    getIncidentStats(),
  ]);
  sendSuccess(res, { ...result, stats });
});

// GET /admin/incidents/stats - Incident summary statistics
export const getIncidentStatsRoute = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await getIncidentStats();
  sendSuccess(res, stats);
});

// GET /admin/incidents/:id - Get single incident detail
export const getSecurityIncidentById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const incident = await fetchIncidentById(id);
  if (!incident) throw ApiError.notFound("Incident not found");
  sendSuccess(res, incident);
});

// POST /admin/incidents - Create new incident
export const createSecurityIncident = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const admin = getAdminInfo(req);
  const body = createIncidentSchema.parse(req.body);
  const incident = await createIncident(body, admin);
  sendSuccess(res, incident, "Incident created successfully", 201);
});

// PATCH /admin/incidents/:id/status - Update incident status
export const updateIncidentStatusRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { status, notes } = incidentStatusSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await updateIncidentStatus(id, status, notes, admin);
  sendSuccess(res, updated, `Incident ${status}`);
});

// PATCH /admin/incidents/:id/severity - Update incident severity
export const updateIncidentSeverityRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { severity, reason } = incidentSeveritySchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await updateIncidentSeverity(id, severity, reason, admin);
  sendSuccess(res, updated, "Incident severity updated");
});

// PATCH /admin/incidents/:id/assign - Assign/reassign incident
export const assignIncidentRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { adminId, adminName } = incidentAssignSchema.parse(req.body);
  const assigner = getAdminInfo(req);
  const updated = await assignIncident(id, adminId, adminName, assigner);
  sendSuccess(res, updated, "Incident assigned");
});

// PATCH /admin/incidents/:id/unassign - Unassign incident
export const unassignIncidentRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const admin = getAdminInfo(req);
  const updated = await unassignIncident(id, admin);
  sendSuccess(res, updated, "Incident unassigned");
});

// POST /admin/incidents/:id/notes - Add investigation note
export const addIncidentNoteRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { note } = incidentNoteSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await addIncidentNote(id, note, admin);
  sendSuccess(res, updated, "Note added");
});

// POST /admin/incidents/:id/evidence - Add evidence/reference
export const addEvidenceRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { description, reference } = incidentEvidenceSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await addEvidence(id, description, reference, admin);
  sendSuccess(res, updated, "Evidence added");
});

// POST /admin/incidents/:id/resolve - Resolve incident
export const resolveIncidentRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { resolutionSummary } = incidentResolveSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await resolveIncident(id, resolutionSummary, admin);
  sendSuccess(res, updated, "Incident resolved");
});

// POST /admin/incidents/:id/close - Close a resolved incident
export const closeIncidentRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { closeReason } = incidentCloseSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await closeIncident(id, closeReason, admin);
  sendSuccess(res, updated, "Incident closed");
});

// POST /admin/incidents/:id/reopen - Reopen a closed/resolved incident
export const reopenIncidentRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { reason, targetStatus } = incidentReopenSchema.parse(req.body);
  const admin = getAdminInfo(req);
  const updated = await reopenIncident(id, reason, admin, targetStatus);
  sendSuccess(res, updated, "Incident reopened");
});

// GET /admin/incidents/:id/timeline - Get incident timeline
export const getIncidentTimelineRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const timeline = await getIncidentTimeline(id);
  sendSuccess(res, timeline);
});

// GET /admin/incidents/:id/security-events - Related security events
export const getRelatedSecurityEventsRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const events = await getRelatedSecurityEvents(id);
  sendSuccess(res, events);
});

// GET /admin/incidents/:id/risk-signals - Related risk signals/anomalies
export const getRelatedRiskSignalsRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const signals = await getRelatedRiskSignals(id);
  sendSuccess(res, signals);
});

// Backward-compatible combined update endpoint
// PATCH /admin/incidents/:id
export const updateSecurityIncident = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { id } = incidentIdParamSchema.parse(req.params);
  const { status, severity, notes } = req.body as { status?: string; severity?: string; notes?: string };
  const admin = getAdminInfo(req);
  const now = new Date();

  if (severity) {
    const typed = await import("../../security/security-incident.model");
    await updateIncidentSeverity(id, severity as any, undefined, admin);
  }

  if (status) {
    await updateIncidentStatus(id, status as any, notes, admin);
  } else if (notes) {
    await addIncidentNote(id, notes, admin);
  }

  const incident = await SecurityIncident.findById(id);
  if (!incident) throw ApiError.notFound("Incident not found");
  sendSuccess(res, incident.toJSON());
});
