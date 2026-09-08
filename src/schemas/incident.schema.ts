import { z } from "zod";

export const incidentIdParamSchema = z.object({
  id: z.string().min(1),
});

export const createIncidentSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  type: z.enum([
    "suspicious_login",
    "account_takeover",
    "authentication_anomaly",
    "api_abuse",
    "rate_limit_abuse",
    "payment_security_anomaly",
    "fraud_pattern",
    "seller_security_incident",
    "suspicious_order_activity",
    "session_anomaly",
    "data_access_anomaly",
    "system_security_incident",
    "other",
  ]).optional(),
  source: z.enum(["manual", "suspicious_activity", "anomaly", "risk_signal", "security_log"]).optional(),
  entityType: z.enum(["user", "seller", "order", "system", "ip_cluster"]),
  entityId: z.string().min(1),
  entityName: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  signals: z.array(z.string()).optional(),
  evidence: z.array(
    z.object({
      description: z.string().min(1),
      reference: z.string().min(1),
    })
  ).optional(),
  relatedSecurityEvents: z.array(z.string()).optional(),
  relatedRiskSignals: z.array(z.string()).optional(),
  detectedAt: z.coerce.date().optional(),
});

export const incidentStatusSchema = z.object({
  status: z.enum([
    "new",
    "open",
    "acknowledged",
    "investigating",
    "mitigated",
    "resolved",
    "closed",
    "dismissed",
    "reopened",
  ]),
  notes: z.string().max(2000).optional(),
});

export const incidentSeveritySchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  reason: z.string().max(500).optional(),
});

export const incidentAssignSchema = z.object({
  adminId: z.string().min(1, "Admin ID is required"),
  adminName: z.string().min(1, "Admin name is required"),
});

export const incidentNoteSchema = z.object({
  note: z.string().min(1, "Note content is required").max(5000),
});

export const incidentEvidenceSchema = z.object({
  description: z.string().min(1).max(1000),
  reference: z.string().min(1).max(500),
});

export const incidentResolveSchema = z.object({
  resolutionSummary: z.string().min(1, "Resolution summary is required").max(2000),
});

export const incidentReopenSchema = z.object({
  reason: z.string().min(1, "Reopen reason is required").max(1000),
  targetStatus: z.enum(["open", "investigating"]).optional().default("investigating"),
});

export const incidentCloseSchema = z.object({
  closeReason: z.string().min(1, "Close reason is required").max(1000),
});

export const incidentQuerySchema = z.object({
  status: z.enum([
    "new", "open", "acknowledged", "investigating", "mitigated", "resolved", "closed", "dismissed", "reopened",
  ]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  assignedTo: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "severity", "riskScore", "detectedAt"]).optional(),
  sortDir: z.enum(["1", "-1"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
