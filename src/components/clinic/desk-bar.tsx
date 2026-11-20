"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, DoorOpen, Search, UserCheck, UserPlus } from "lucide-react";
import {
  createPatientAction,
  deskSearchAction,
  freeSlotsAction,
  walkInAction,
} from "@/app/actions/clinic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Choice } from "@/components/public/choice";
import type { AppointmentStatus } from "@/lib/booking/status";
import type { DeskHit } from "@/lib/front-desk/desk";
import { normalizePhoneQuery } from "@/lib/patients/phone";
import { StatusBadge } from "./badges";
import type { PickOption, ServiceOption } from "./booking-dialog";
import { ContactButtons } from "./contact-buttons";
import { FormError } from "./form-message";
import { riyadhParts } from "./time";
import { useAction } from "./use-action";
import { useCheckIn } from "./use-check-in";

type Who = { id: string; nameAr: string; nameEn: string | null };

/**
 * Reception's fast lane, above the calendar: type a mobile (or name / file number) and act at
 * once — check in today's visit, walk-in (book the next free time + check in: two taps), book
 * later, call or WhatsApp. Unknown mobile → create the patient right here.
 */
export function DeskBar({
  branchId,
  day,
  services,
  doctors,
  canCreate,
  canWhatsApp,
}: {
  branchId: string;
  /** Today (Riyadh) — walk-ins are always today. */
  day: string;
  services: ServiceOption[];
  doctors: PickOption[];
  canCreate: boolean;
  canWhatsApp: boolean;
}) {
  const t = useTranslations("desk");
  const ts = useTranslations("statuses");
  const locale = useLocale();
  const toast = useToast();
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DeskHit[] | null>(null);
  const [walkIn, setWalkIn] = useState<Who | null>(null);
  const { checkIn, busyId, error, consentDialog, askConsent } = useCheckIn();
  const create = useAction();
  const [newName, setNewName] = useState("");
  const [gender, setGender] = useState<"" | "female" | "male">("");

  const q = query.trim();
  const mobile = normalizePhoneQuery(q);
  const isMobile = /^05\d{8}$/.test(mobile) && !/[A-Za-z؀-ۿ]/.test(q);

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      const r = await deskSearchAction(q);
      if (!cancelled && r.ok) setHits(r.data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);
  const shown = q.length >= 2 ? hits : null;

  const reset = () => {
    setQuery("");
    setHits(null);
    setNewName("");
    setGender("");
  };

  return (
    <Card className="flex flex-col gap-2 p-3" data-testid="desk-bar">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
        <Input
          className="ps-9"
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputMode="search"
          autoComplete="off"
          data-testid="desk-search"
        />
      </div>
      <FormError message={error} />

      {shown && (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="desk-results">
          {shown.map((h) => {
            const today = h.today;
            const here = today && today.branchId === branchId;
            const canCheckIn = here && ["booked", "confirmed"].includes(today.status);
            const open = today && ["booked", "confirmed", "arrived", "in_session"].includes(today.status);
            const target = {
              id: today?.id ?? "",
              balance: null,
              patient: { id: h.id, nameAr: h.nameAr, nameEn: h.nameEn },
            };
            return (
              <li
                key={h.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                data-testid="desk-hit"
                data-patient={h.fileNumber}
              >
                <Link
                  href={`/patients/${h.id}`}
                  className="flex min-w-0 flex-1 flex-col hover:underline"
                >
                  <span className="truncate font-medium">{name(h)}</span>
                  <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                    {h.fileNumber} · {h.phone}
                  </span>
                </Link>
                {today && (
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <span className="font-mono" dir="ltr">
                      {riyadhParts(today.startsAt).time}
                    </span>
                    <StatusBadge
                      status={today.status as AppointmentStatus}
                      label={ts(today.status as AppointmentStatus)}
                    />
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  {canCheckIn ? (
                    <Button
                      size="sm"
                      loading={busyId === target.id}
                      onClick={() => {
                        checkIn(target);
                        reset();
                      }}
                      data-testid="desk-check-in"
                    >
                      {busyId !== target.id && <UserCheck />}
                      {t("checkIn")}
                    </Button>
                  ) : (
                    !open && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setWalkIn(h)}
                        data-testid="desk-walk-in"
                      >
                        <DoorOpen />
                        {t("walkIn")}
                      </Button>
                    )
                  )}
                  <Link
                    href={`/calendar?date=${day}&view=day&patient=${h.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    data-testid="desk-book"
                  >
                    <CalendarPlus />
                    {t("book")}
                  </Link>
                  <ContactButtons patientId={h.id} phone={h.phone} whatsapp={canWhatsApp} />
                </span>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="flex flex-col gap-2 px-3 py-3 text-sm">
              <span className="text-muted-foreground">{t("noMatch")}</span>
              {isMobile && canCreate && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  data-testid="desk-new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newName.trim().length < 3 || !gender) return;
                    create.run(
                      () =>
                        createPatientAction({
                          fullNameAr: newName.trim(),
                          phone: mobile,
                          gender,
                        }),
                      (p) => {
                        toast(t("created", { name: newName.trim() }));
                        setWalkIn({ id: p.id, nameAr: newName.trim(), nameEn: null });
                        reset();
                      },
                    );
                  }}
                >
                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    <Label htmlFor="desk-new-name">{t("newName", { mobile })}</Label>
                    <Input
                      id="desk-new-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={120}
                      data-testid="desk-new-name"
                    />
                  </div>
                  <Select
                    aria-label={t("gender")}
                    value={gender}
                    onChange={(e) => setGender(e.target.value as typeof gender)}
                    className="w-32"
                    data-testid="desk-new-gender"
                  >
                    <option value="">{t("gender")}</option>
                    <option value="female">{t("female")}</option>
                    <option value="male">{t("male")}</option>
                  </Select>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={newName.trim().length < 3 || !gender}
                    loading={create.pending}
                    data-testid="desk-new-submit"
                  >
                    {!create.pending && <UserPlus />}
                    {t("createWalkIn")}
                  </Button>
                  <FormError message={create.error} />
                </form>
              )}
            </li>
          )}
        </ul>
      )}

      {walkIn && (
        <WalkInDialog
          who={walkIn}
          branchId={branchId}
          day={day}
          services={services}
          doctors={doctors}
          onClose={() => setWalkIn(null)}
          onDone={(appointmentId, consent) => {
            const who = walkIn;
            setWalkIn(null);
            reset();
            const target = {
              id: appointmentId,
              balance: null,
              patient: { id: who.id, nameAr: who.nameAr, nameEn: who.nameEn },
            };
            if (consent) askConsent(target, consent);
            else toast(t("checkedIn", { name: name(who) }));
          }}
        />
      )}
      {consentDialog}
    </Card>
  );
}

/** Walk-in: pick the service, tap a free time today → booked and checked in. */
function WalkInDialog({
  who,
  branchId,
  day,
  services,
  doctors,
  onClose,
  onDone,
}: {
  who: Who;
  branchId: string;
  day: string;
  services: ServiceOption[];
  doctors: PickOption[];
  onClose: () => void;
  onDone: (
    appointmentId: string,
    consent: Parameters<ReturnType<typeof useCheckIn>["askConsent"]>[1] | null,
  ) => void;
}) {
  const t = useTranslations("desk");
  const tc = useTranslations("common");
  const locale = useLocale();
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [slots, setSlots] = useState<{ startsAt: string; practitionerId: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = useAction();

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    freeSlotsAction({ branchId, serviceId, day, limit: 8 }).then((r) => {
      if (!cancelled) setSlots(r.ok ? r.data.filter((s) => riyadhParts(s.startsAt).day === day) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [branchId, serviceId, day]);

  const doctor = (id: string) => {
    const d = doctors.find((x) => x.id === id);
    return d ? name(d) : "";
  };

  return (
    <Dialog open onClose={onClose} title={t("walkInTitle", { name: name(who) })} closeLabel={tc("close")}>
      <div className="flex flex-col gap-4" data-testid="walk-in-dialog">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="walk-in-service">{tc("service")}</Label>
          <Select
            id="walk-in-service"
            value={serviceId}
            onChange={(e) => {
              setSlots(null);
              setServiceId(e.target.value);
            }}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)} ({tc("minutes", { count: s.durationMinutes })})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("nextFree")}</span>
          {slots === null ? (
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : slots.length ? (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <Choice
                  key={`${s.startsAt}-${s.practitionerId}`}
                  disabled={act.pending}
                  data-testid="walk-in-slot"
                  onClick={() => {
                    setBusy(s.startsAt + s.practitionerId);
                    act.run(
                      () =>
                        walkInAction({
                          branchId,
                          patientId: who.id,
                          serviceId,
                          practitionerId: s.practitionerId,
                          startsAt: s.startsAt,
                        }),
                      (r) =>
                        onDone(r.appointmentId, r.status === "consent_required" ? r.template : null),
                    );
                  }}
                >
                  <span className="font-mono font-medium" dir="ltr">
                    {riyadhParts(s.startsAt).time}
                    {busy === s.startsAt + s.practitionerId && act.pending ? " …" : ""}
                  </span>
                  <span className="text-muted-foreground text-xs">{doctor(s.practitionerId)}</span>
                </Choice>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noFree")}</p>
          )}
          <p className="text-muted-foreground text-[13px]">{t("walkInHint")}</p>
        </div>
        <FormError message={act.error} />
      </div>
    </Dialog>
  );
}
