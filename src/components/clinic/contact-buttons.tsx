"use client";

import { useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { telLink } from "@/lib/front-desk/contact";
import { cn } from "@/lib/utils";

/**
 * One-tap Call and WhatsApp for a patient. WhatsApp opens their chat in the clinic inbox (or
 * WhatsApp on this device when there's no chat yet) — only for staff who use the inbox.
 */
export function ContactButtons({
  patientId,
  phone,
  whatsapp,
  className,
}: {
  patientId: string;
  phone: string;
  whatsapp: boolean;
  className?: string;
}) {
  const t = useTranslations("desk");
  const icon = buttonVariants({ variant: "outline", size: "icon" });
  return (
    <span className={cn("inline-flex gap-1.5", className)}>
      <a
        href={telLink(phone)}
        className={icon}
        aria-label={t("call", { phone })}
        title={t("call", { phone })}
        data-testid="contact-call"
        onClick={(e) => e.stopPropagation()}
      >
        <Phone />
      </a>
      {whatsapp && (
        <a
          href={`/whatsapp/open/${patientId}`}
          className={icon}
          aria-label={t("whatsapp")}
          title={t("whatsapp")}
          data-testid="contact-whatsapp"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageCircle />
        </a>
      )}
    </span>
  );
}
