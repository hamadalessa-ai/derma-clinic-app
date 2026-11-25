"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { setActiveBranch } from "@/app/actions/branch";

export function BranchSwitcher({
  branches,
  activeId,
}: {
  branches: { id: string; name: string }[];
  activeId: string | null;
}) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (branches.length <= 1) {
    return (
      <div className="hidden items-center gap-2 text-sm sm:flex">
        <MapPin className="text-brand-strong size-4" />
        {branches[0]?.name}
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <MapPin className="text-brand-strong size-4" />
      <span className="sr-only">{t("branch")}</span>
      <select
        className="border-input bg-card focus-visible:ring-ring h-9 max-w-36 rounded-lg border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          startTransition(async () => {
            await setActiveBranch(id);
            router.refresh();
          });
        }}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
