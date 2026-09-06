/**
 * Clamps a computed score into [min, max] and rounds it, replacing the
 * repeated `Math.min(X, Math.max(Y, Math.round(...)))` pattern used across
 * trust/quality/value/popularity/reliability/decision score calculations.
 */
export function clampScore(value: number, min: number = 0, max: number = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}