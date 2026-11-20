/**
 * Dental chart basics (pure, shared by server and browser): FDI tooth numbers, conditions and
 * surfaces, and the chart's current state from its history.
 *
 * FDI: first digit = quadrant (1 upper right, 2 upper left, 3 lower left, 4 lower right, from
 * the patient's side), second = tooth from the middle (1 central incisor … 8 wisdom tooth).
 * The chart is drawn as the dentist faces the patient: upper 18→11 | 21→28, lower 48→41 | 31→38.
 */

export const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

export function isTooth(n: number): boolean {
  return Number.isInteger(n) && n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8;
}

export const TOOTH_CONDITIONS = [
  "healthy",
  "caries",
  "filled",
  "crown",
  "root_canal",
  "missing",
  "implant",
  "bridge",
  "extraction_needed",
  "watch",
] as const;
export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];

/** Mesial, occlusal (biting), distal, buccal (cheek side), lingual (tongue side). */
export const SURFACES = ["M", "O", "D", "B", "L"] as const;

/** Keeps only valid surface letters, once each, in the standard order. */
export function normalizeSurfaces(v: string): string {
  const up = v.toUpperCase();
  return SURFACES.filter((s) => up.includes(s)).join("");
}

/** Conditions that need treatment (shown in the warning colour). */
export const NEEDS_TREATMENT: readonly ToothCondition[] = ["caries", "extraction_needed"];

export interface ChartEntryLike {
  tooth: number;
  condition: ToothCondition;
  surfaces: string;
  createdAt: Date | string;
}

/** The chart now: the latest entry per tooth ("healthy" = nothing recorded). */
export function currentChart<T extends ChartEntryLike>(entries: T[]): Map<number, T> {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const out = new Map<number, T>();
  for (const e of sorted) {
    if (e.condition === "healthy") out.delete(e.tooth);
    else out.set(e.tooth, e);
  }
  return out;
}
