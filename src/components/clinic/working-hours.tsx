"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarX, Copy, Plus, Save, Trash2 } from "lucide-react";
import {
  addHoursExceptionAction,
  removeHoursExceptionAction,
  saveWeeklyHoursAction,
} from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatGregorian } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Branch = { id: string; nameAr: string; nameEn: string };
type WeeklyShift = { weekday: number; branchId: string; start: string; end: string };

/** Saudi working week order: Saturday first, Friday last. */
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

function useNames() {
  const locale = useLocale() as Locale;
  const dayName = (wd: number) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-SA", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 0, 4 + wd))); // 4 Jan 2026 was a Sunday
  const branchName = (b: Branch | undefined) => (b ? (locale === "en" ? b.nameEn : b.nameAr) : "");
  return { locale, dayName, branchName };
}

/** The weekly pattern: for each day, off or one or more shifts (each at a branch). */
export function WeeklyHoursEditor({
  memberId,
  branches,
  initial,
}: {
  memberId: string;
  branches: Branch[];
  initial: WeeklyShift[];
}) {
  const t = useTranslations("hours");
  const { dayName, branchName } = useNames();
  const [shifts, setShifts] = useState<WeeklyShift[]>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const oneBranch = branches.length === 1;

  const update = (i: number, patch: Partial<WeeklyShift>) => {
    setMsg(null);
    setShifts((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const add = (weekday: number) => {
    setMsg(null);
    const day = shifts.filter((s) => s.weekday === weekday);
    const last = day.sort((a, b) => a.end.localeCompare(b.end)).at(-1);
    const start = last ? (last.end < "17:00" ? "17:00" : last.end) : "10:00";
    const end = last ? (start < "21:00" ? "21:00" : "23:00") : "14:00";
    setShifts((list) => [
      ...list,
      { weekday, branchId: last?.branchId ?? branches[0]?.id ?? "", start, end },
    ]);
  };
  const remove = (i: number) => {
    setMsg(null);
    setShifts((list) => list.filter((_, j) => j !== i));
  };
  /** Copies one day's shifts to every other day that has shifts (days off stay off). */
  const copyToWorkingDays = (weekday: number) => {
    setMsg(null);
    const source = shifts.filter((s) => s.weekday === weekday);
    const working = new Set(shifts.map((s) => s.weekday));
    setShifts((list) => [
      ...list.filter((s) => s.weekday === weekday || !working.has(s.weekday)),
      ...[...working]
        .filter((wd) => wd !== weekday)
        .flatMap((wd) => source.map((s) => ({ ...s, weekday: wd }))),
    ]);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="weekly-hours">
      {DAY_ORDER.map((wd) => {
        const day = shifts
          .map((s, i) => ({ s, i }))
          .filter((x) => x.s.weekday === wd)
          .sort((a, b) => a.s.start.localeCompare(b.s.start));
        return (
          <div
            key={wd}
            className="flex flex-col gap-2 border-b pb-3 last:border-b-0"
            data-weekday={wd}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{dayName(wd)}</span>
              <span className="flex gap-1">
                {day.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToWorkingDays(wd)}
                    title={t("copyHint")}
                  >
                    <Copy />
                    {t("copy")}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => add(wd)} data-testid="add-shift">
                  <Plus />
                  {day.length ? t("addShift") : t("addHours")}
                </Button>
              </span>
            </div>
            {day.length === 0 && <p className="text-muted-foreground text-sm">{t("dayOff")}</p>}
            {day.map(({ s, i }) => (
              <div key={i} className="flex flex-wrap items-end gap-2" data-testid="shift">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`start-${i}`}>{t("from")}</Label>
                  <Input
                    id={`start-${i}`}
                    type="time"
                    step={900}
                    className="w-32"
                    value={s.start}
                    onChange={(e) => update(i, { start: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`end-${i}`}>{t("to")}</Label>
                  <Input
                    id={`end-${i}`}
                    type="time"
                    step={900}
                    className="w-32"
                    value={s.end}
                    onChange={(e) => update(i, { end: e.target.value })}
                  />
                </div>
                {oneBranch ? (
                  <span className="text-muted-foreground pb-2 text-sm">
                    {branchName(branches[0])}
                  </span>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`branch-${i}`}>{t("branch")}</Label>
                    <Select
                      id={`branch-${i}`}
                      className="w-40"
                      value={s.branchId}
                      onChange={(e) => update(i, { branchId: e.target.value })}
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {branchName(b)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("removeShift")}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">{t("breakHint")}</p>
      <Button
        className="self-start"
        disabled={pending}
        data-testid="save-hours"
        onClick={() =>
          run(
            () => saveWeeklyHoursAction({ memberId, shifts }),
            (r) => setMsg(r.conflicts.length ? t("savedConflicts") : t("saved")),
          )
        }
      >
        <Save />
        {t("save")}
      </Button>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

export interface ExceptionView {
  id: string;
  day: string;
  kind: "off" | "hours";
  branchId: string | null;
  start: string | null;
  end: string | null;
  note: string | null;
}

/** One-off changes for single dates: a day off, special hours, or an extra working day. */
export function HoursExceptions({
  memberId,
  branches,
  exceptions,
  today,
}: {
  memberId: string;
  branches: Branch[];
  exceptions: ExceptionView[];
  today: string;
}) {
  const t = useTranslations("hours");
  const { locale, branchName } = useNames();
  const [day, setDay] = useState(today);
  const [kind, setKind] = useState<"off" | "hours">("off");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("22:00");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  return (
    <div className="flex flex-col gap-4" data-testid="hours-exceptions">
      {exceptions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noChanges")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {exceptions.map((e) => (
            <li
              key={e.id}
              className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-1.5"
              data-testid="hours-exception"
            >
              <span>
                <span className="font-medium">
                  {formatGregorian(new Date(`${e.day}T12:00:00+03:00`), locale, "full")}
                </span>
                {" · "}
                {e.kind === "off" ? (
                  t("off")
                ) : (
                  <>
                    <span dir="ltr">
                      {e.start}–{e.end}
                    </span>
                    {branches.length > 1 &&
                      ` · ${branchName(branches.find((b) => b.id === e.branchId))}`}
                  </>
                )}
                {e.note ? ` · ${e.note}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("removeChange")}
                disabled={pending}
                onClick={() => run(() => removeHoursExceptionAction({ id: e.id }))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="exc-day">{t("date")}</Label>
          <Input
            id="exc-day"
            type="date"
            min={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="exc-kind">{t("change")}</Label>
          <Select
            id="exc-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value === "hours" ? "hours" : "off")}
          >
            <option value="off">{t("kindOff")}</option>
            <option value="hours">{t("kindHours")}</option>
          </Select>
        </div>
        {kind === "hours" && (
          <>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="exc-start">{t("from")}</Label>
                <Input
                  id="exc-start"
                  type="time"
                  step={900}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="exc-end">{t("to")}</Label>
                <Input
                  id="exc-end"
                  type="time"
                  step={900}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            {branches.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="exc-branch">{t("branch")}</Label>
                <Select
                  id="exc-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {branchName(b)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="exc-note">{t("note")}</Label>
          <Input
            id="exc-note"
            value={note}
            maxLength={200}
            placeholder={t("notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t("changeHint")}</p>
      <Button
        className="self-start"
        disabled={pending || !day}
        data-testid="add-exception"
        onClick={() =>
          run(
            () =>
              addHoursExceptionAction({
                memberId,
                day,
                kind,
                branchId: kind === "hours" ? branchId : null,
                start: kind === "hours" ? start : null,
                end: kind === "hours" ? end : null,
                note: note || null,
              }),
            (r) => {
              setNote("");
              setMsg(r.conflicts.length ? t("savedConflicts") : t("saved"));
            },
          )
        }
      >
        <CalendarX />
        {t("addChange")}
      </Button>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}
