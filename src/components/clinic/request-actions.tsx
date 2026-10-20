"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { decideRequestAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

export function RequestActions({ requestId }: { requestId: string }) {
  const t = useTranslations("requests");
  const [note, setNote] = useState("");
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("note")}
          className="max-w-64"
          aria-label={t("note")}
        />
        <Button
          disabled={pending}
          onClick={() =>
            run(() => decideRequestAction({ requestId, approve: true, note: note || undefined }))
          }
        >
          {t("approve")}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => decideRequestAction({ requestId, approve: false, note: note || undefined }))
          }
        >
          {t("reject")}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
