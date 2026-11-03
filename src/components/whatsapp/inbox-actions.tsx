"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, CheckCircle2, Hand, Link2, Search, Send, UserPlus } from "lucide-react";
import {
  searchPatientsAction,
  whatsappAiPauseAction,
  whatsappCreatePatientAction,
  whatsappHandledAction,
  whatsappLinkAction,
  whatsappReplyAction,
} from "@/app/actions/clinic";
import { FormError, FormSuccess } from "@/components/clinic/form-message";
import { useAction } from "@/components/clinic/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";

/** Reply box. Outside the 24-hour window it explains why free replies aren't possible. */
export function ReplyBox({
  conversationId,
  canReplyFreely,
  windowEndsAt,
}: {
  conversationId: string;
  canReplyFreely: boolean;
  windowEndsAt: string | null;
}) {
  const t = useTranslations("whatsapp");
  const te = useTranslations("errors");
  const [text, setText] = useState("");
  const { run, pending, error, setError } = useAction();
  if (!canReplyFreely) {
    return (
      <Notice tone="warning" data-testid="outside-window">
        {t("outsideWindow")}
      </Notice>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => whatsappReplyAction({ conversationId, text }),
          (r) => {
            if (r.outcome === "failed")
              setError(te("unexpected") + (r.error ? ` (#${r.error})` : ""));
            else setText("");
          },
        );
      }}
    >
      {windowEndsAt && (
        <p className="text-muted-foreground text-xs">{t("insideWindow", { time: windowEndsAt })}</p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("replyPlaceholder")}
          aria-label={t("replyPlaceholder")}
          rows={2}
          required
          data-testid="reply-text"
        />
        <Button type="submit" disabled={pending} data-testid="reply-send">
          <Send className="rtl:-scale-x-100" />
          {t("send")}
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}

export function MarkHandled({ conversationId }: { conversationId: string }) {
  const t = useTranslations("whatsapp");
  const { run, pending, error } = useAction();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => whatsappHandledAction({ conversationId }))}
        data-testid="mark-handled"
      >
        <CheckCircle2 />
        {t("markHandled")}
      </Button>
      <FormError message={error} />
    </>
  );
}

/** Staff take over the chat (AI stays quiet) or let the AI receptionist answer it again. */
export function AiPauseToggle({
  conversationId,
  paused,
}: {
  conversationId: string;
  paused: boolean;
}) {
  const t = useTranslations("whatsapp.ai");
  const { run, pending, error } = useAction();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => whatsappAiPauseAction({ conversationId, paused: !paused }))}
        data-testid={paused ? "ai-resume" : "ai-take-over"}
      >
        {paused ? <Bot /> : <Hand />}
        {paused ? t("letAiAnswer") : t("takeOver")}
      </Button>
      <FormError message={error} />
    </>
  );
}

type Hit = { id: string; fileNumber: string; nameAr: string; nameEn: string | null; phone: string };

/** A new number: link it to an existing patient, or create a new patient. */
export function LinkOrCreatePatient({
  conversationId,
  suggestedName,
}: {
  conversationId: string;
  suggestedName: string | null;
}) {
  const t = useTranslations("whatsapp");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, startSearch] = useTransition();
  const [name, setName] = useState(suggestedName ?? "");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  useEffect(() => {
    if (query.trim().length < 2) return;
    const id = setTimeout(
      () =>
        startSearch(async () => {
          const r = await searchPatientsAction(query);
          setHits(r.ok ? r.data : []);
        }),
      300,
    );
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div className="flex flex-col gap-4" data-testid="link-or-create">
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4" />
          {t("linkTitle")}
        </h3>
        <div className="relative">
          <Search className="text-muted-foreground absolute start-2.5 top-3 size-4" />
          <Input
            className="ps-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("linkSearch")}
            aria-label={t("linkSearch")}
            data-testid="link-search"
          />
        </div>
        {query.trim().length >= 2 && !searching && (
          <ul className="flex flex-col divide-y rounded-md border">
            {hits.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {h.nameAr}{" "}
                  <span className="text-muted-foreground" dir="ltr">
                    {h.fileNumber} · {h.phone}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => whatsappLinkAction({ conversationId, patientId: h.id }),
                      () => setMsg(t("linked")),
                    )
                  }
                  data-testid="link-patient"
                >
                  {t("link")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!gender) return;
          run(
            () => whatsappCreatePatientAction({ conversationId, fullNameAr: name, gender }),
            (p) => router.push(`/patients/${p.id}`),
          );
        }}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="size-4" />
          {t("createTitle")}
        </h3>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-name">{t("fullName")}</Label>
          <Input
            id="new-name"
            required
            minLength={3}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <fieldset className="flex gap-2">
          <legend className="mb-1 text-sm font-medium">{t("gender")}</legend>
          {(["female", "male"] as const).map((g) => (
            <label
              key={g}
              className="border-input has-[:checked]:border-brand flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
            >
              <input
                type="radio"
                name="new-gender"
                required
                checked={gender === g}
                onChange={() => setGender(g)}
              />
              {t(g)}
            </label>
          ))}
        </fieldset>
        <Button
          type="submit"
          variant="outline"
          disabled={pending}
          className="self-start"
          data-testid="create-patient"
        >
          {t("create")}
        </Button>
      </form>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}
