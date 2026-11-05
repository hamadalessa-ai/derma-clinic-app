import { AlertTriangle, Globe, Layers, MessageCircle } from "lucide-react";
import type { AppointmentStatus } from "@/lib/booking/status";
import { cn } from "@/lib/utils";
import { STATUS_CLASSES } from "./status";

/** Appointment status pill. `label` comes from translations (statuses.<status>). */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: AppointmentStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {label}
    </span>
  );
}

export interface AlertsView {
  allergies: string[];
  contraindications: string[];
  medications: string[];
}

/** Medical warning badge: shown wherever the patient appears, when they have allergies/contraindications. */
export function AlertBadge({
  alerts,
  label,
  compact = false,
}: {
  alerts: AlertsView | undefined;
  label: string;
  compact?: boolean;
}) {
  if (!alerts) return null;
  const items = [...alerts.allergies, ...alerts.contraindications];
  if (!items.length && !alerts.medications.length) return null;
  const warning = items.length > 0;
  const title = [...items, ...alerts.medications].join(" • ");
  return (
    <span
      title={title}
      aria-label={`${label}: ${title}`}
      data-testid="alert-badge"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium",
        warning ? "bg-danger text-danger-foreground" : "bg-warning text-warning-foreground",
      )}
    >
      <AlertTriangle className="size-3.5" />
      {!compact && <span className="max-w-48 truncate">{items[0] ?? alerts.medications[0]}</span>}
    </span>
  );
}

/** Where a booking came from. Reception bookings show nothing (the usual case). */
export function SourceBadge({
  source,
  label,
  compact = false,
}: {
  source: "reception" | "online" | "whatsapp";
  label: string;
  compact?: boolean;
}) {
  if (source === "reception") return null;
  const Icon = source === "online" ? Globe : MessageCircle;
  return (
    <span
      data-testid="source-badge"
      data-source={source}
      title={label}
      aria-label={label}
      className="bg-brand-soft text-brand-strong inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium"
    >
      <Icon className="size-3.5" />
      {!compact && <span>{label}</span>}
    </span>
  );
}

/** Package balance, e.g. "3/6 left". */
export function BalanceBadge({
  remaining,
  total,
  label,
}: {
  remaining: number;
  total: number;
  label: string;
}) {
  return (
    <span
      data-testid="balance-badge"
      title={label}
      className="bg-gold text-gold-foreground inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 font-mono text-xs font-medium"
    >
      <Layers className="size-3.5" />
      <span dir="ltr">
        {remaining}/{total}
      </span>
    </span>
  );
}
