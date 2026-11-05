"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { bookAction, freeSlotsAction, searchPatientsAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Choice } from "@/components/public/choice";
import { FormError } from "./form-message";
import { riyadhParts, timeOptions } from "./time";
import { useAction } from "./use-action";

export interface PickOption {
  id: string;
  nameAr: string;
  nameEn: string | null;
}
export interface ServiceOption extends PickOption {
  durationMinutes: number;
}
type PatientHit = {
  id: string;
  fileNumber: string;
  nameAr: string;
  nameEn: string | null;
  phone: string;
};

export function BookingDialog({
  open,
  onClose,
  branchId,
  services,
  doctors,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  services: ServiceOption[];
  doctors: PickOption[];
  defaults: { day: string; time?: string; doctorId?: string; patient?: PatientHit | null };
}) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const locale = useLocale();
  const toast = useToast();
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;

  const [patient, setPatient] = useState<PatientHit | null>(defaults.patient ?? null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  /** "" = any doctor (the first one free). From a calendar column: that doctor. */
  const [doctorId, setDoctorId] = useState(defaults.doctorId ?? "");
  const [day, setDay] = useState(defaults.day);
  const [time, setTime] = useState(defaults.time ?? "10:00");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<{ startsAt: string; practitionerId: string }[] | null>(null);
  const [chosen, setChosen] = useState<{ startsAt: string; practitionerId: string } | null>(null);
  /** Exact day/time/doctor typed in, instead of tapping a free time. */
  const [manual, setManual] = useState(false);
  const { run, pending, error } = useAction();

  useEffect(() => {
    if (!open || patient) return;
    const id = setTimeout(async () => {
      const r = await searchPatientsAction(query);
      if (r.ok) setHits(r.data);
    }, 250);
    return () => clearTimeout(id);
  }, [query, open, patient]);

  // Slot-first: the next free times appear as soon as the service (or doctor/day) is chosen.
  useEffect(() => {
    if (!open || !serviceId || manual) return;
    let cancelled = false;
    freeSlotsAction({
      branchId,
      serviceId,
      practitionerId: doctorId || undefined,
      day,
      time: day === defaults.day ? defaults.time : undefined,
      limit: 8,
    }).then((r) => {
      if (cancelled) return;
      const list = r.ok ? r.data : [];
      setSlots(list);
      // Opened from a calendar cell: that exact time is pre-chosen when it's free.
      const exact =
        defaults.time &&
        list.find((x) => {
          const p = riyadhParts(x.startsAt);
          return p.day === defaults.day && p.time === defaults.time;
        });
      setChosen(exact || null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, serviceId, doctorId, day, manual, branchId, defaults.day, defaults.time]);

  const doctorName = (id: string) => {
    const d = doctors.find((x) => x.id === id);
    return d ? name(d) : "";
  };
  const ready = !!patient && !!serviceId && (manual ? !!doctorId : !!chosen);

  return (
    <Dialog open={open} onClose={onClose} title={t("newBooking")} closeLabel={tc("close")}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patient-search">{tc("patient")}</Label>
        {patient ? (
          <div
            className="bg-muted flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            data-testid="selected-patient"
          >
            <span>
              <span className="font-medium">{name(patient)}</span> ·{" "}
              <span dir="ltr" className="font-mono">
                {patient.fileNumber}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPatient(null)}>
              {t("change")}
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
              <Input
                id="patient-search"
                className="ps-9"
                placeholder={t("searchPatient")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
            <ul
              className="max-h-44 overflow-y-auto rounded-lg border"
              role="listbox"
              aria-label={t("pickPatient")}
            >
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="hover:bg-muted flex w-full justify-between gap-2 px-3 py-2 text-start text-sm"
                    onClick={() => setPatient(h)}
                  >
                    <span className="font-medium">{name(h)}</span>
                    <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                      {h.fileNumber} · {h.phone}
                    </span>
                  </button>
                </li>
              ))}
              {hits.length === 0 && (
                <li className="text-muted-foreground px-3 py-2 text-sm">{t("noResults")}</li>
              )}
            </ul>
            <Link href="/patients/new" className="text-brand-strong text-xs underline">
              {t("newPatient")}
            </Link>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service">{tc("service")}</Label>
          <Select id="service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)} ({tc("minutes", { count: s.durationMinutes })})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doctor">{tc("doctor")}</Label>
          <Select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {!manual && <option value="">{t("anyDoctor")}</option>}
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!manual ? (
        <div className="flex flex-col gap-2" data-testid="slot-picker">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("nextSlots")}</Label>
            <Input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              dir="ltr"
              className="h-8 w-auto text-sm"
              aria-label={tc("date")}
            />
          </div>
          {slots === null ? (
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-24 rounded-lg" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noSlots")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const p = riyadhParts(s.startsAt);
                const on =
                  chosen?.startsAt === s.startsAt && chosen.practitionerId === s.practitionerId;
                return (
                  <Choice
                    key={s.startsAt + s.practitionerId}
                    selected={on}
                    className="items-center text-center"
                    data-testid="free-slot"
                    data-day={p.day}
                    onClick={() => setChosen(s)}
                  >
                    <span dir="ltr" className="font-mono font-medium">
                      {p.time}
                    </span>
                    <span className="text-muted-foreground text-[11px] leading-4">
                      {p.day !== day ? `${p.day.slice(5)} · ` : ""}
                      {!doctorId ? doctorName(s.practitionerId) : ""}
                    </span>
                  </Choice>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="text-brand-strong self-start text-xs underline"
            onClick={() => {
              setManual(true);
              if (!doctorId) setDoctorId(defaults.doctorId ?? doctors[0]?.id ?? "");
            }}
          >
            {t("otherTime")}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="day">{tc("date")}</Label>
            <Input
              id="day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="time">{tc("time")}</Label>
            <Select id="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr">
              {timeOptions().map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="button"
            className="text-brand-strong self-start text-xs underline sm:col-span-2"
            onClick={() => setManual(false)}
          >
            {t("showFreeTimes")}
          </button>
        </div>
      )}

      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          {t("note")} ({tc("optional")})
        </summary>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-2 min-h-16"
          aria-label={t("note")}
        />
      </details>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button
          disabled={!ready}
          loading={pending}
          data-testid="book-submit"
          onClick={() => {
            const p = chosen && !manual ? riyadhParts(chosen.startsAt) : null;
            run(
              () =>
                bookAction({
                  branchId,
                  patientId: patient!.id,
                  serviceId,
                  practitionerId: p ? chosen!.practitionerId : doctorId,
                  day: p ? p.day : day,
                  time: p ? p.time : time,
                  note: note || undefined,
                }),
              () => {
                toast(t("bookedOk", { name: name(patient!) }));
                onClose();
              },
            );
          }}
        >
          {t("book")}
        </Button>
      </div>
    </Dialog>
  );
}
