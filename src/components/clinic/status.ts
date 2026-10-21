import type { AppointmentStatus } from "@/lib/booking/status";

/** Status → theme token classes (colours live in globals.css). */
export const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  booked: "bg-status-booked text-status-booked-foreground",
  confirmed: "bg-status-confirmed text-status-confirmed-foreground",
  arrived: "bg-status-arrived text-status-arrived-foreground",
  in_session: "bg-status-in-session text-status-in-session-foreground",
  completed: "bg-status-completed text-status-completed-foreground",
  no_show: "bg-status-no-show text-status-no-show-foreground",
  cancelled: "bg-status-cancelled text-status-cancelled-foreground line-through",
};

export const BLOCKED_CLASSES = "bg-status-blocked text-status-blocked-foreground";
