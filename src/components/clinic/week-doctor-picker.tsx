"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/** Week view: which doctor's week is shown (a short list instead of a button per doctor). */
export function WeekDoctorPicker({
  label,
  value,
  options,
}: {
  label: string;
  /** The link of the doctor shown now. */
  value: string;
  options: { href: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <Select
      aria-label={label}
      value={value}
      className="h-9 w-auto"
      data-testid="week-doctor"
      onChange={(e) => router.push(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.href} value={o.href}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
