"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { generateVapidKeys } from "@/lib/push/vapid";

function CopyRow({ name, value, secret }: { name: string; value: string; secret?: boolean }) {
  const t = useTranslations("pushKeys");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs font-semibold" dir="ltr">
          {name}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      <code
        className={`bg-muted rounded-md p-2 font-mono text-xs break-all ${secret ? "blur-sm hover:blur-none focus:blur-none" : ""}`}
        dir="ltr"
        tabIndex={0}
        data-testid={`vapid-${name}`}
      >
        {value}
      </code>
    </div>
  );
}

export function VapidKeyGenerator() {
  const t = useTranslations("pushKeys");
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        className="self-start"
        onClick={async () => setKeys(await generateVapidKeys())}
        data-testid="vapid-generate"
      >
        <KeyRound />
        {t("generate")}
      </Button>
      {keys && (
        <div className="flex flex-col gap-3">
          <Notice tone="warning">{t("privateWarning")}</Notice>
          <CopyRow name="VAPID_PUBLIC_KEY" value={keys.publicKey} />
          <CopyRow name="VAPID_PRIVATE_KEY" value={keys.privateKey} secret />
          <CopyRow name="VAPID_SUBJECT" value="mailto:you@example.com" />
          <ol className="list-decimal space-y-1 ps-5">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
            <li>{t("step4")}</li>
          </ol>
        </div>
      )}
    </div>
  );
}
