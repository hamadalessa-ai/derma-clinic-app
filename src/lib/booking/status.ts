export const APPOINTMENT_STATUSES = [
  "pending",
  "booked",
  "confirmed",
  "arrived",
  "in_session",
  "completed",
  "no_show",
  "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Which status can follow which. Anything not listed is refused. */
export const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  // Online booking awaiting reception approval: approve → confirmed, reject → cancelled.
  pending: ["confirmed", "cancelled"],
  booked: ["confirmed", "arrived", "no_show", "cancelled"],
  confirmed: ["arrived", "no_show", "cancelled"],
  arrived: ["in_session", "cancelled"],
  in_session: ["completed"],
  completed: [],
  no_show: [],
  cancelled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus) {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that still occupy the doctor, room and device. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  "pending",
  "booked",
  "confirmed",
  "arrived",
  "in_session",
  "completed",
];

/** Only appointments that haven't started can be moved. */
export const MOVABLE_STATUSES: readonly AppointmentStatus[] = ["pending", "booked", "confirmed"];
