/**
 * The reception flow board: where each of today's patients is, and since when.
 * Expected → Waiting → With nurse → With doctor → Checkout → Done. Pure functions (flow.test.ts).
 */
import type { AppointmentStatus } from "@/lib/booking/status";

export const FLOW_STAGES = ["expected", "waiting", "nurse", "doctor", "checkout", "done"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export interface FlowInput {
  status: AppointmentStatus;
  startsAt: string;
  flow: {
    arrivedAt: string | null;
    inRoomAt: string | null;
    doctorAt: string | null;
    completedAt: string | null;
    /** Reception's checkout (visit_checkouts). */
    checkedOutAt: string | null;
  };
}

/** The board column, or null for appointments that don't belong on it (cancelled, pending, no-show). */
export function flowStage(a: FlowInput): FlowStage | null {
  switch (a.status) {
    case "booked":
    case "confirmed":
      return "expected";
    case "arrived":
      return "waiting";
    case "in_session":
      return a.flow.doctorAt ? "doctor" : "nurse";
    case "completed":
      return a.flow.checkedOutAt ? "done" : "checkout";
    default:
      return null;
  }
}

/**
 * Since when the patient has been in this stage (ISO). Older visits without flow times fall back
 * to the appointment time. "Expected" counts from the booked time (late when it's past).
 */
export function stageSince(a: FlowInput, stage: FlowStage): string {
  const f = a.flow;
  switch (stage) {
    case "expected":
      return a.startsAt;
    case "waiting":
      return f.arrivedAt ?? a.startsAt;
    case "nurse":
      return f.inRoomAt ?? f.arrivedAt ?? a.startsAt;
    case "doctor":
      return f.doctorAt ?? f.inRoomAt ?? a.startsAt;
    case "checkout":
      return f.completedAt ?? a.startsAt;
    case "done":
      return f.checkedOutAt ?? f.completedAt ?? a.startsAt;
  }
}

/** Whole minutes from `since` to `now` (never negative). */
export function minutesSince(since: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
}

/** Waiting longer than this (minutes) is highlighted on the board. */
export const LONG_WAIT_MINUTES = 15;
/** An expected patient this late (minutes) is highlighted. */
export const LATE_MINUTES = 10;

/** Should this card stand out? A long wait in the waiting area, or a patient running late. */
export function needsAttention(a: FlowInput, stage: FlowStage, now: Date): boolean {
  if (stage === "waiting") return minutesSince(stageSince(a, stage), now) >= LONG_WAIT_MINUTES;
  if (stage === "expected")
    return now.getTime() - new Date(a.startsAt).getTime() >= LATE_MINUTES * 60_000;
  return false;
}
