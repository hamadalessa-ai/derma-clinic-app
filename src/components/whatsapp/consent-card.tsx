"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BellOff, BellRing, MessageCircle } from "lucide-react";
import { whatsappConsentAction } from "@/app/actions/clinic";
import { FormError } from "@/components/clinic/form-message";
import { useAction } from "@/components/clinic/use-action";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/** Patient file: WhatsApp consent (who/when/how), STOP, language, and a link to the chat. */
export function WhatsAppConsentCard({
  patientId,
  optInAt,
  optInSource,
  optedOutAt,
  language,
  conversationId,
  canEdit,
  formatDate,
}: {
  patientId: string;
  optInAt: string | null;
  optInSource: string | null;
  optedOutAt: string | null;
  language: "ar" | "en";
  conversationId: string | null;
  canEdit: boolean;
  formatDate: Record<string, string>;
}) {
  const t = useTranslations("whatsapp");
  const { run, pending, error } = useAction();
  const agreed = !!optInAt && !optedOutAt;
  const source =
    optInSource && t.has(`sources.${optInSource}`) ? t(`sources.${optInSource}`) : optInSource;
  return (
    <div
      className="flex flex-col gap-3 text-sm"
      data-testid="whatsapp-consent"
      data-agreed={agreed}
    >
      <div className="flex items-start gap-2">
        {agreed ? (
          <BellRing className="text-brand mt-0.5 size-4 shrink-0" />
        ) : (
          <BellOff className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        )}
        <div>
          {optedOutAt
            ? t("consentStopped", { date: formatDate[optedOutAt] ?? "" })
            : optInAt
              ? t("consentYes", { date: formatDate[optInAt] ?? "", source: source ?? "" })
              : t("consentNo")}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {agreed ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => whatsappConsentAction({ patientId, optIn: false }))}
              data-testid="whatsapp-opt-out"
            >
              {t("withdrawConsent")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => whatsappConsentAction({ patientId, optIn: true }))}
              data-testid="whatsapp-opt-in"
            >
              {t("recordConsent")}
            </Button>
          )}
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("language")}</span>
            <Select
              className="h-8 w-28"
              defaultValue={language}
              disabled={pending}
              onChange={(e) =>
                run(() =>
                  whatsappConsentAction({
                    patientId,
                    optIn: agreed,
                    language: e.target.value as "ar" | "en",
                  }),
                )
              }
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </label>
        </div>
      )}
      {conversationId && canEdit && (
        <Link
          href={`/whatsapp?f=all&c=${conversationId}`}
          className="text-brand inline-flex items-center gap-1 self-start underline"
        >
          <MessageCircle className="size-4" />
          {t("openChat")}
        </Link>
      )}
      <FormError message={error} />
    </div>
  );
}
