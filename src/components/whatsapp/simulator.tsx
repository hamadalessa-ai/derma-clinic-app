"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Paperclip, Play, Send } from "lucide-react";
import {
  runScheduledNowAction,
  simulatorPhotoAction,
  simulatorReadAction,
  simulatorTapAction,
  simulatorTypeAction,
} from "@/app/actions/clinic";
import { FormError, FormSuccess } from "@/components/clinic/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessageView } from "@/lib/whatsapp/view";
import { cn } from "@/lib/utils";
import { ChatThread } from "./chat";

function useActionError() {
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    fail: (code: string) => setError(te.has(code) ? te(code) : te("unexpected")),
  };
}

/**
 * Shrinks a picked photo in the browser (max 1280 px, JPEG) so it fits the
 * server's upload limit — like WhatsApp itself compresses photos.
 */
async function photoToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}

/** The patient's phone: WhatsApp-style chat with the clinic. Taps and typing go through the
 *  same inbound handler as real WhatsApp. */
export function SimulatorPhone({
  conversationId,
  phone,
  clinicName,
  messages,
  fullScreen = false,
  backHref,
}: {
  conversationId: string;
  phone: string;
  clinicName: string;
  messages: ChatMessageView[];
  fullScreen?: boolean;
  backHref?: string;
}) {
  const t = useTranslations("whatsapp");
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const { error, clear, fail } = useActionError();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    simulatorReadAction({ conversationId }).catch(() => {});
    bottom.current?.scrollIntoView({ block: "end" });
  }, [conversationId, messages.length]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      clear();
      const r = await fn();
      if (!r.ok) return fail((r as { error: string }).error);
      router.refresh();
    });

  return (
    <div
      className={cn(
        "bg-chat-bg flex flex-col overflow-hidden",
        fullScreen
          ? "h-dvh"
          : "border-foreground/80 h-[640px] max-h-[80dvh] rounded-[2rem] border-8 shadow-lg",
      )}
      data-testid="simulator-phone"
      data-conversation={conversationId}
    >
      <div className="bg-chat-header text-chat-header-foreground flex items-center gap-3 px-3 py-2.5">
        {backHref && (
          <a href={backHref} aria-label={t("back")} className="shrink-0">
            <ArrowRight className="size-5 ltr:hidden rtl:block" />
            <ArrowLeft className="size-5 ltr:block rtl:hidden" />
          </a>
        )}
        <div className="bg-brand text-brand-foreground flex size-9 shrink-0 items-center justify-center rounded-full font-bold">
          {clinicName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-semibold">{clinicName}</div>
          <div className="text-xs opacity-80">{t("online")}</div>
        </div>
      </div>
      <div className="bg-info text-info-foreground px-3 py-1 text-center text-[11px]" role="note">
        {t("demoLabel")} · <span dir="ltr">{phone}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChatThread
          messages={messages}
          perspective="patient"
          tapping={pending}
          onTap={(messageId, buttonIndex) =>
            run(() => simulatorTapAction({ messageId, buttonIndex }))
          }
        />
        <div ref={bottom} />
      </div>
      <FormError message={error} />
      <form
        className="bg-chat-bg flex items-center gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const value = text;
          setText("");
          run(() => simulatorTypeAction({ phone, text: value }));
        }}
      >
        <label
          className="text-chat-meta hover:text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full"
          aria-label={t("simAttachPhoto")}
          title={t("simAttachPhoto")}
        >
          <Paperclip className="size-5" aria-hidden />
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            data-testid="simulator-photo"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const caption = text.trim();
              setText("");
              run(async () =>
                simulatorPhotoAction({
                  phone,
                  dataUrl: await photoToDataUrl(file),
                  caption: caption || undefined,
                }),
              );
            }}
          />
        </label>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("simTypeHere")}
          aria-label={t("simTypeHere")}
          className="bg-chat-in rounded-full"
          data-testid="simulator-input"
        />
        <Button
          type="submit"
          size="icon"
          className="bg-chat-header text-chat-header-foreground shrink-0 rounded-full"
          disabled={pending}
          aria-label={t("send")}
        >
          <Send className="rtl:-scale-x-100" />
        </Button>
      </form>
    </div>
  );
}

/** "Simulate a message from a new number" (it lands in the inbox as "not a patient yet"). */
export function SimulateNewNumber() {
  const t = useTranslations("whatsapp");
  const router = useRouter();
  const [v, setV] = useState({ phone: "", profileName: "", text: "" });
  const [pending, start] = useTransition();
  const { error, clear, fail } = useActionError();
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="simulate-new-number"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          clear();
          const r = await simulatorTypeAction(v);
          if (!r.ok) return fail(r.error);
          setV({ phone: "", profileName: "", text: "" });
          router.push(`/whatsapp/simulator?c=${r.data.conversationId}`);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-phone">{t("simPhone")}</Label>
        <Input
          id="sim-phone"
          dir="ltr"
          inputMode="tel"
          required
          placeholder="05XXXXXXXX"
          value={v.phone}
          onChange={(e) => setV({ ...v, phone: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-name">{t("simName")}</Label>
        <Input
          id="sim-name"
          value={v.profileName}
          onChange={(e) => setV({ ...v, profileName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-text">{t("simText")}</Label>
        <Textarea
          id="sim-text"
          required
          rows={2}
          value={v.text}
          onChange={(e) => setV({ ...v, text: e.target.value })}
        />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="self-start">
        <Send />
        {t("simSend")}
      </Button>
    </form>
  );
}

/** Demo only (admin): run the scheduler now, optionally 24 hours ahead / ignoring quiet hours. */
export function RunScheduledNow() {
  const t = useTranslations("whatsapp");
  const router = useRouter();
  const [fastForward, setFastForward] = useState(false);
  const [ignoreQuietHours, setIgnoreQuiet] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { error, clear, fail } = useActionError();
  const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-2" data-testid="run-now">
      <p className="text-muted-foreground text-sm">{t("runNowHint")}</p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-brand mt-0.5 size-4"
          checked={fastForward}
          onChange={(e) => setFastForward(e.target.checked)}
          data-testid="fast-forward"
        />
        {t("fastForward")}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-brand mt-0.5 size-4"
          checked={ignoreQuietHours}
          onChange={(e) => setIgnoreQuiet(e.target.checked)}
          data-testid="ignore-quiet"
        />
        {t("ignoreQuiet")}
      </label>
      <FormError message={error} />
      <FormSuccess message={msg} />
      <Button
        className="self-start"
        disabled={pending}
        data-testid="run-now-button"
        onClick={() =>
          start(async () => {
            clear();
            setMsg(null);
            const r = await runScheduledNowAction({ fastForward, ignoreQuietHours });
            if (!r.ok) return fail(r.error);
            setMsg(
              r.data.quietHours
                ? t("quietNow")
                : t("runResult", {
                    sent: total(r.data.sent),
                    skipped: total(r.data.skipped),
                    failed: total(r.data.failed),
                  }),
            );
            router.refresh();
          })
        }
      >
        <Play />
        {t("runNow")}
      </Button>
    </div>
  );
}
