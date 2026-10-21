"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Search, Sparkles } from "lucide-react";
import { bookAction, freeSlotsAction, searchPatientsAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;

  const [patient, setPatient] = useState<PatientHit | null>(defaults.patient ?? null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [doctorId, setDoctorId] = useState(defaults.doctorId ?? doctors[0]?.id ?? "");
  const [day, setDay] = useState(defaults.day);
  const [time, setTime] = useState(defaults.time ?? "10:00");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<{ startsAt: string; practitionerId: string }[] | null>(null);
  const { run, pending, error } = useAction();
  const slotSearch = useAction();

  useEffect(() => {
    if (!open || patient) return;
    const id = setTimeout(async () => {
      const r = await searchPatientsAction(query);
      if (r.ok) setHits(r.data);
    }, 250);
    return () => clearTimeout(id);
  }, [query, open, patient]);

  return (
    <Dialog open={open} onClose={onClose} title={t("newBooking")} closeLabel={tc("close")}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patient-search">{tc("patient")}</Label>
        {patient ? (
          <div
            className="bg-muted flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            data-testid="selected-patient"
          >
            <span>
              <span className="font-medium">{name(patient)}</span> ·{" "}
              <span dir="ltr">{patient.fileNumber}</span>
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
              />
            </div>
            <ul
              className="max-h-44 overflow-y-auto rounded-md border"
              role="listbox"
              aria-label={t("pickPatient")}
            >
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="hover:bg-accent flex w-full justify-between gap-2 px-3 py-2 text-start text-sm"
                    onClick={() => setPatient(h)}
                  >
                    <span className="font-medium">{name(h)}</span>
                    <span className="text-muted-foreground text-xs" dir="ltr">
                      {h.fileNumber} · {h.phone}
                    </span>
                  </button>
                </li>
              ))}
              {hits.length === 0 && (
                <li className="text-muted-foreground px-3 py-2 text-sm">{t("noResults")}</li>
              )}
            </ul>
            <Link href="/patients/new" className="text-brand text-xs underline">
              {t("newPatient")}
            </Link>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service">{tc("service")}</Label>
          <Select
            id="service"
            value={serviceId}
            onChange={(e) => (setServiceId(e.target.value), setSlots(null))}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)} ({tc("minutes", { count: s.durationMinutes })})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doctor">{tc("doctor")}</Label>
          <Select
            id="doctor"
            value={doctorId}
            onChange={(e) => (setDoctorId(e.target.value), setSlots(null))}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </Select>
        </div>
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
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={slotSearch.pending}
          onClick={() =>
            slotSearch.run(
              () =>
                freeSlotsAction({
                  branchId,
                  serviceId,
                  practitionerId: doctorId || undefined,
                  day,
                  time,
                }),
              (data) => setSlots(data),
            )
          }
        >
          <Sparkles />
          {t("findNextSlot")}
        </Button>
        {slots && (
          <div className="flex flex-wrap gap-2" aria-label={t("nextSlots")}>
            {slots.length === 0 && (
              <span className="text-muted-foreground text-sm">{t("noSlots")}</span>
            )}
            {slots.map((s) => {
              const p = riyadhParts(s.startsAt);
              return (
                <Button
                  key={s.startsAt + s.practitionerId}
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="free-slot"
                  onClick={() => {
                    setDay(p.day);
                    setTime(p.time);
                    setDoctorId(s.practitionerId);
                  }}
                >
                  <span dir="ltr">
                    {p.day.slice(5)} {p.time}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
        <FormError message={slotSearch.error} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">
          {t("note")} ({tc("optional")})
        </Label>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
        />
      </div>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button
          disabled={pending || !patient || !serviceId || !doctorId}
          onClick={() =>
            run(
              () =>
                bookAction({
                  branchId,
                  patientId: patient!.id,
                  serviceId,
                  practitionerId: doctorId,
                  day,
                  time,
                  note: note || undefined,
                }),
              () => onClose(),
            )
          }
        >
          {t("book")}
        </Button>
      </div>
    </Dialog>
  );
}
