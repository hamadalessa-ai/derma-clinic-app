"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/** A short list that goes to the chosen page (phones: instead of a long row of tabs). */
export function NavSelect({
  label,
  value,
  groups,
  testId,
}: {
  label: string;
  value: string;
  groups: { label: string; options: { href: string; label: string }[] }[];
  testId?: string;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label={label}
      value={value}
      className="h-10 w-full"
      data-testid={testId}
      onChange={(e) => router.push(e.target.value)}
    >
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.href} value={o.href}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
