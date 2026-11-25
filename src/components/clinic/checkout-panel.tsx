"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarPlus, Check, MessageCircle } from "lucide-react";
import { bookAction, checkOutAction, sendVisitInstructionsAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

/** Payment: amount (the amount due, editable), method, the clinic system's invoice number. */
export function PaymentForm({
  appointmentId,
  dueHalalas,
  offerSend = false,
}: {
  appointmentId: string;
  dueHalalas: number;
  /** The care instructions haven't been sent yet: "Complete checkout" also sends them (ticked). */
  offerSend?: boolean;
}) {
  const t = useTranslations("checkout");
  const router = useRouter();
  const act = useAction();
  const [paid, setPaid] = useState((dueHalalas / 100).toFixed(2));
  const [method, setMethod] = useState<"" | "cash" | "card" | "transfer">(
    dueHalalas > 0 ? "card" : "",
  );
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [send, setSend] = useState(offerSend);
  const amount = Number(paid.replace(",", "."));
  const valid = Number.isFinite(amount) && amount >= 0 && (amount === 0 || method !== "");

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="payment-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        act.run(
          async () => {
            const r = await checkOutAction({
              appointmentId,
              paidSar: amount,
              method: amount > 0 && method ? method : null,
              invoiceNumber: invoice || null,
              note: note || null,
            });
            // The checkout is recorded either way; a send that can't go out shows on the
            // instructions card, which still has its own "Send on WhatsApp".
            if (r.ok && send) await sendVisitInstructionsAction(appointmentId).catch(() => null);
            return r;
          },
          () => router.refresh(),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="co-paid">{t("paid")}</Label>
          <Input
            id="co-paid"
            inputMode="decimal"
            dir="ltr"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            data-testid="checkout-paid"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="co-method">{t("method")}</Label>
          <Select
            id="co-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            data-testid="checkout-method"
          >
            <option value="">{t("noPayment")}</option>
            <option value="card">{t("methods.card")}</option>
            <option value="cash">{t("methods.cash")}</option>
            <option value="transfer">{t("methods.transfer")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="co-invoice">{t("invoiceNumber")}</Label>
          <Input
            id="co-invoice"
            dir="ltr"
            maxLength={60}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            placeholder="INV-…"
            data-testid="checkout-invoice"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="co-note">{t("note")}</Label>
          <Input
            id="co-note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-[13px]">{t("invoiceHint")}</p>
      {offerSend && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-brand size-4"
            checked={send}
            onChange={(e) => setSend(e.target.checked)}
            data-testid="checkout-send-instructions"
          />
          <MessageCircle className="text-muted-foreground size-4" />
          {t("alsoSend")}
        </label>
      )}
      <Button
        type="submit"
        className="self-start"
        disabled={!valid}
        loading={act.pending}
        data-testid="checkout-submit"
      >
        {!act.pending && <Check />}
        {t("complete")}
      </Button>
      <FormError message={act.error} />
    </form>
  );
}

/** One suggested plan session: book it at the suggested free time (reception's booking). */
export function BookPlanSession({
  branchId,
  patientId,
  serviceId,
  practitionerId,
  day,
  time,
}: {
  branchId: string;
  patientId: string;
  serviceId: string;
  practitionerId: string;
  day: string;
  time: string;
}) {
  const t = useTranslations("checkout");
  const act = useAction();
  const [done, setDone] = useState(false);
  if (done) return <span className="text-sm font-medium">{t("booked")}</span>;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        loading={act.pending}
        data-testid="book-plan-session"
        onClick={() =>
          act.run(
            () => bookAction({ branchId, patientId, serviceId, practitionerId, day, time }),
            () => setDone(true),
          )
        }
      >
        {!act.pending && <CalendarPlus />}
        {t("book")}
      </Button>
      <FormError message={act.error} />
    </div>
  );
}

/** Book every suggested plan session at its suggested time, one after the other. */
export function BookAllPlanSessions({
  sessions,
}: {
  sessions: {
    branchId: string;
    patientId: string;
    serviceId: string;
    practitionerId: string;
    day: string;
    time: string;
  }[];
}) {
  const t = useTranslations("checkout");
  const act = useAction();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        loading={act.pending}
        data-testid="book-all-plan"
        onClick={() =>
          act.run(async () => {
            for (const s of sessions) {
              const r = await bookAction(s);
              if (!r.ok) return r;
            }
            return { ok: true as const, data: null };
          })
        }
      >
        {!act.pending && <CalendarPlus />}
        {t("bookAll", { count: sessions.length })}
      </Button>
      <FormError message={act.error} />
    </div>
  );
}

/** Send the patient the WhatsApp link to their instructions (once per visit). */
export function SendInstructions({
  appointmentId,
  sentAt,
}: {
  appointmentId: string;
  sentAt: string | null;
}) {
  const t = useTranslations("checkout");
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (sentAt) return <span className="text-muted-foreground text-sm">{t("sent")}</span>;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        loading={act.pending}
        data-testid="send-instructions"
        onClick={() =>
          act.run(
            () => sendVisitInstructionsAction(appointmentId),
            (r) =>
              setMsg(
                r.outcome === "skipped"
                  ? t("notSent", { reason: r.reason })
                  : r.outcome === "failed"
                    ? t("sendFailed")
                    : t("sentNow"),
              ),
          )
        }
      >
        {!act.pending && <MessageCircle />}
        {t("send")}
      </Button>
      <FormError message={act.error} />
      <FormSuccess message={msg} inline />
    </div>
  );
}
