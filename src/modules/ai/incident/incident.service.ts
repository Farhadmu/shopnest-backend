import { AiIncident, AiIncidentType } from "./incident.model";
import { logger } from "../../../utils/logger";

/**
 * Records AI failures/edge-cases for later review. This feeds the SRS
 * "AI R&D Documentation" requirement (limitations, cost considerations,
 * failure modes) and the admin Security & Audit Center.
 */
export async function logAiIncident(input: {
  type: AiIncidentType;
  userId?: string;
  endpoint: string;
  input?: string;
  error?: string;
}) {
  try {
    await AiIncident.create({ ...input, input: input.input?.slice(0, 500) });
  } catch (err) {
    logger.error("Failed to log AI incident", err);
  }
}
