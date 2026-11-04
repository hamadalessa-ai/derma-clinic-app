/**
 * Doctors' working hours: a weekly pattern (one or more shifts per weekday, each at a branch) and
 * one-off changes for single dates (day off, or special hours that replace that day's pattern).
 *
 * One place decides "when does this doctor work on this date", for booking, free times, the
 * calendar, online booking and the AI receptionist alike.
 */
import { and, gte, inArray, lte } from "drizzle-orm";
import { scheduleExceptions, staffSchedules } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { atRiyadh, minutesOf, weekdayOf } from "./time";

/** A weekly-pattern row (older rows may carry a break: they count as two shifts). */
export type WeeklyRow = Pick<
  typeof staffSchedules.$inferSelect,
  "memberId" | "branchId" | "weekday" | "startTime" | "endTime" | "breakStart" | "breakEnd"
>;
export type ExceptionRow = Pick<
  typeof scheduleExceptions.$inferSelect,
  "memberId" | "branchId" | "day" | "kind" | "startTime" | "endTime"
>;

/** A shift as clock times ("10:00"–"14:00") at a branch. */
export interface ClockShift {
  branchId: string;
  start: string;
  end: string;
}

const hhmm = (t: string) => t.slice(0, 5);

/** The weekly shifts of one row: a row with a break becomes two shifts. */
export function rowShifts(r: WeeklyRow): ClockShift[] {
  const start = hhmm(r.startTime);
  const end = hhmm(r.endTime);
  if (r.breakStart && r.breakEnd) {
    return [
      { branchId: r.branchId, start, end: hhmm(r.breakStart) },
      { branchId: r.branchId, start: hhmm(r.breakEnd), end },
    ].filter((s) => s.start < s.end);
  }
  return [{ branchId: r.branchId, start, end }];
}

/**
 * The doctor's shifts on one date (all branches), sorted. A one-off change for that date wins
 * over the weekly pattern; "off" (or a change at other branches only) means no shifts here.
 */
export function clockShiftsOn(
  memberId: string,
  day: string,
  weekly: readonly WeeklyRow[],
  exceptions: readonly ExceptionRow[],
): ClockShift[] {
  const changes = exceptions.filter((e) => e.memberId === memberId && String(e.day) === day);
  const shifts: ClockShift[] = changes.length
    ? changes
        .filter((e) => e.kind === "hours" && e.branchId && e.startTime && e.endTime)
        .map((e) => ({ branchId: e.branchId!, start: hhmm(e.startTime!), end: hhmm(e.endTime!) }))
    : weekly
        .filter((w) => w.memberId === memberId && w.weekday === weekdayOf(day))
        .flatMap(rowShifts);
  return shifts.sort((a, b) => a.start.localeCompare(b.start));
}

/** Weekly rows and one-off changes for some doctors over some dates (one query each). */
export async function loadHourRows(tx: TenantTx, memberIds: readonly string[], days: string[]) {
  if (!memberIds.length) return { weekly: [] as WeeklyRow[], exceptions: [] as ExceptionRow[] };
  const sorted = [...days].sort();
  const [weekly, exceptions] = await Promise.all([
    tx
      .select()
      .from(staffSchedules)
      .where(inArray(staffSchedules.memberId, [...memberIds])),
    sorted.length
      ? tx
          .select()
          .from(scheduleExceptions)
          .where(
            and(
              inArray(scheduleExceptions.memberId, [...memberIds]),
              gte(scheduleExceptions.day, sorted[0]),
              lte(scheduleExceptions.day, sorted[sorted.length - 1]),
            ),
          )
      : Promise.resolve([]),
  ]);
  return { weekly, exceptions };
}

export interface Shift {
  start: Date;
  end: Date;
}

/** Clock shifts at one branch on one date, as real times. */
export function shiftsAt(day: string, branchId: string, shifts: ClockShift[]): Shift[] {
  return shifts
    .filter((s) => s.branchId === branchId)
    .map((s) => ({ start: atRiyadh(day, s.start), end: atRiyadh(day, s.end) }));
}

/** For screens: shifts at a branch as minutes since midnight, with the gaps between them. */
export function minutesView(shifts: ClockShift[], branchId: string) {
  const here = shifts.filter((s) => s.branchId === branchId);
  if (!here.length) return null;
  const parts = here.map((s) => ({ start: minutesOf(s.start), end: minutesOf(s.end) }));
  const breaks = parts.slice(1).map((p, i) => ({ start: parts[i].end, end: p.start }));
  return {
    start: parts[0].start,
    end: parts[parts.length - 1].end,
    breaks: breaks.filter((b) => b.start < b.end),
  };
}

/** Do any two shifts of a day overlap (at any branches)? */
export function overlapping(shifts: { start: string; end: string }[]) {
  const s = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
  return s.some((x, i) => i > 0 && x.start < s[i - 1].end);
}
