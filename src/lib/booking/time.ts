/**
 * Clinic time helpers. Saudi Arabia is UTC+3 all year (no daylight saving), so a clinic
 * day "2026-10-21" runs from 2026-10-20T21:00Z to 2026-10-21T21:00Z.
 */
export const RIYADH_OFFSET = "+03:00";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export function isDay(value: unknown): value is string {
  return typeof value === "string" && DAY_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** "2026-10-21" + "10:30" → the exact moment in Riyadh. */
export function atRiyadh(day: string, time: string): Date {
  if (!isDay(day) || !TIME_RE.test(time)) throw new Error(`bad day/time: ${day} ${time}`);
  return new Date(`${day}T${time.length === 5 ? `${time}:00` : time}${RIYADH_OFFSET}`);
}

/** The clinic day (Riyadh) a moment falls on, as "YYYY-MM-DD". */
export function riyadhDay(date: Date): string {
  return new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** "HH:MM" in Riyadh. */
export function riyadhTime(date: Date): string {
  return new Date(date.getTime() + 3 * 3600_000).toISOString().slice(11, 16);
}

/** 0 = Sunday … 6 = Saturday, for a clinic day. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** [start, end) of a clinic day. */
export function dayRange(day: string): [Date, Date] {
  return [atRiyadh(day, "00:00"), atRiyadh(addDays(day, 1), "00:00")];
}

/** Sunday-based week containing `day` (Saudi working week starts on Sunday). */
export function weekDays(day: string): string[] {
  const start = addDays(day, -weekdayOf(day));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** Minutes since midnight for "HH:MM[:SS]". */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
