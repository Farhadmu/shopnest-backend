import { AIEvidence } from "./ai-types";

export class AiEvidenceService {
  /**
   * Constructs a typed database evidence item
   */
  public static fromDatabase(
    source: string,
    fact: string,
    value: string | number | boolean,
    resourceId?: string
  ): AIEvidence {
    return {
      type: "DATABASE",
      source,
      fact,
      value,
      resourceId,
      timestamp: new Date(),
    };
  }

  /**
   * Constructs a calculated analytical evidence item
   */
  public static fromCalculation(
    source: string,
    fact: string,
    value: string | number | boolean,
    resourceId?: string
  ): AIEvidence {
    return {
      type: "CALCULATION",
      source,
      fact,
      value,
      resourceId,
      timestamp: new Date(),
    };
  }

  /**
   * Constructs a catalog search evidence item
   */
  public static fromSearch(
    source: string,
    fact: string,
    value: string | number | boolean,
    resourceId?: string
  ): AIEvidence {
    return {
      type: "SEARCH",
      source,
      fact,
      value,
      resourceId,
      timestamp: new Date(),
    };
  }

  /**
   * Constructs a system telemetry or state evidence item
   */
  public static fromSystem(
    source: string,
    fact: string,
    value: string | number | boolean,
    resourceId?: string
  ): AIEvidence {
    return {
      type: "SYSTEM",
      source,
      fact,
      value,
      resourceId,
      timestamp: new Date(),
    };
  }

  /**
   * Deduplicates and formats evidence items for injection into LLM prompt
   */
  public static formatForPrompt(evidence: AIEvidence[]): string {
    if (!evidence || evidence.length === 0) return "";

    const lines: string[] = ["=== VERIFIED SHOPNEST DATABASE EVIDENCE ==="];
    const seen = new Set<string>();

    for (const item of evidence) {
      const key = `${item.source}:${item.fact}:${item.value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resText = item.resourceId ? ` [ID: ${item.resourceId}]` : "";
      lines.push(`• [${item.type}] ${item.source}${resText} -> ${item.fact}: ${item.value}`);
    }

    lines.push("=== END EVIDENCE (Strictly ground your answer on these verified facts) ===");
    return lines.join("\n");
  }
}

// Evidence verification confidence levels
export const EVIDENCE_CONFIDENCE_THRESHOLD = 0.95;
