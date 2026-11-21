"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import {
  createConsentFormAction,
  saveBranchAction,
  saveDepartmentAction,
  saveDeviceAction,
  saveBillingItemAction,
  saveMembershipPlanAction,
  savePackageAction,
  saveRoomAction,
  saveServiceAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

// ─── Data the page passes in (plain values) ─────────────────────────────────

export interface SetupData {
  branches: {
    id: string;
    nameAr: string;
    nameEn: string;
    cityAr: string;
    cityEn: string;
    mapUrl: string | null;
    sortOrder: number;
  }[];
  departments: {
    id: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
    sortOrder: number;
  }[];
  services: {
    id: string;
    departmentId: string;
    nameAr: string;
    nameEn: string;
    durationMinutes: number;
    bufferMinutes: number;
    priceHalalas: number;
    requiredDeviceType: string | null;
    consentCode: string | null;
    onlineBookable: boolean;
    isVirtual: boolean;
    isActive: boolean;
    preVisitAr: string | null;
    preVisitEn: string | null;
    postCareAr: string | null;
    postCareEn: string | null;
    recallAfterDays: number | null;
    doctorIds: string[];
  }[];
  rooms: {
    id: string;
    branchId: string;
    nameAr: string;
    nameEn: string;
    isVirtual: boolean;
    departmentId: string | null;
    isActive: boolean;
  }[];
  devices: {
    id: string;
    branchId: string;
    roomId: string | null;
    deviceType: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
  }[];
  packages: {
    id: string;
    serviceId: string;
    nameAr: string;
    nameEn: string;
    sessionsCount: number;
    priceHalalas: number;
    validityDays: number;
    isActive: boolean;
  }[];
  memberships: {
    id: string;
    nameAr: string;
    nameEn: string;
    priceHalalas: number;
    periodMonths: number;
    includedServiceId: string | null;
    includedVisits: number;
    discountPercent: number;
    isActive: boolean;
  }[];
  billingItems: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    kind: "product" | "consumable" | "procedure" | "other";
    priceHalalas: number;
    unitAr: string | null;
    unitEn: string | null;
    isActive: boolean;
  }[];
  consents: { code: string; titleAr: string; titleEn: string; version: number }[];
  doctors: { id: string; name: string; nameEn: string | null }[];
}

export type SetupTab =
  | "branches"
  | "departments"
  | "services"
  | "rooms"
  | "packages"
  | "memberships"
  | "prices"
  | "consents";

function useL() {
  const ar = useLocale() === "ar";
  return (a: string | null | undefined, e: string | null | undefined) =>
    (ar ? a || e : e || a) ?? "";
}
const sar = (h: number) => (h / 100).toFixed(2).replace(/\.00$/, "");

/** One dialog per edit: the form, its error, and Save. */
function EditDialog({
  title,
  open,
  onClose,
  onSave,
  pending,
  error,
  children,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
  error: string | null;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations("setup");
  return (
    <Dialog open={open} onClose={onClose} title={title} className={wide ? "max-w-2xl" : undefined}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        data-testid="setup-form"
      >
        {children}
        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" loading={pending} data-testid="setup-save">
            {t("save")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      {label}
    </label>
  );
}

function Toolbar({
  title,
  hint,
  onAdd,
  addLabel,
}: {
  title: string;
  hint?: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      <Button onClick={onAdd} data-testid="setup-add">
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

function Row({
  children,
  onEdit,
  muted,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  muted?: boolean;
}) {
  const t = useTranslations("setup");
  return (
    <li
      className={`flex items-center gap-3 border-b px-4 py-3 last:border-b-0 ${muted ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        aria-label={t("edit")}
        data-testid="setup-edit"
      >
        <Pencil />
        <span className="hidden sm:inline">{t("edit")}</span>
      </Button>
    </li>
  );
}

function ListCard({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  return (
    <Card>
      <CardContent className="p-0">
        {children.length ? (
          <ul>{children}</ul>
        ) : (
          <p className="text-muted-foreground p-6 text-center text-sm">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── The screen ─────────────────────────────────────────────────────────────

export function ClinicSetup({ tab, data }: { tab: SetupTab; data: SetupData }) {
  if (tab === "branches") return <Branches data={data} />;
  if (tab === "departments") return <Departments data={data} />;
  if (tab === "services") return <Services data={data} />;
  if (tab === "rooms") return <Rooms data={data} />;
  if (tab === "packages") return <Packages data={data} />;
  if (tab === "memberships") return <Memberships data={data} />;
  if (tab === "prices") return <Prices data={data} />;
  return <Consents data={data} />;
}

function useSaved() {
  const t = useTranslations("setup");
  const [msg, setMsg] = useState<string | null>(null);
  return { msg, saved: () => setMsg(t("saved")) };
}

// ─── Branches ───────────────────────────────────────────────────────────────

function Branches({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const empty = {
    id: null as string | null,
    nameAr: "",
    nameEn: "",
    cityAr: "",
    cityEn: "",
    mapUrl: "",
    sortOrder: 0,
  };
  const [v, setV] = useState<typeof empty | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("branches")}
        hint={t("branchesHint")}
        addLabel={t("addBranch")}
        onAdd={() => setV(empty)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.branches.map((b) => (
          <Row key={b.id} onEdit={() => setV({ ...b, mapUrl: b.mapUrl ?? "" })}>
            <span className="font-medium">{L(b.nameAr, b.nameEn)}</span>
            <span className="text-muted-foreground text-xs">
              {L(b.cityAr, b.cityEn)} ·{" "}
              {t("roomsCount", { n: data.rooms.filter((r) => r.branchId === b.id).length })}
            </span>
          </Row>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          title={v.id ? t("editBranch") : t("addBranch")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () => saveBranchAction({ ...v, mapUrl: v.mapUrl || null }),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="b-ar" label={t("nameAr")}>
              <Input
                id="b-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="b-en" label={t("nameEn")}>
              <Input
                id="b-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <Field id="b-car" label={t("cityAr")}>
              <Input
                id="b-car"
                dir="rtl"
                required
                value={v.cityAr}
                onChange={(e) => setV({ ...v, cityAr: e.target.value })}
              />
            </Field>
            <Field id="b-cen" label={t("cityEn")}>
              <Input
                id="b-cen"
                dir="ltr"
                required
                value={v.cityEn}
                onChange={(e) => setV({ ...v, cityEn: e.target.value })}
              />
            </Field>
          </div>
          <Field id="b-map" label={t("mapUrl")} hint={t("mapHint")}>
            <Input
              id="b-map"
              dir="ltr"
              type="url"
              value={v.mapUrl}
              onChange={(e) => setV({ ...v, mapUrl: e.target.value })}
            />
          </Field>
          {!v.id && <p className="text-muted-foreground text-xs">{t("newBranchRoom")}</p>}
        </EditDialog>
      )}
    </div>
  );
}

// ─── Departments ────────────────────────────────────────────────────────────

function Departments({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const empty = { id: null as string | null, nameAr: "", nameEn: "", isActive: true, sortOrder: 0 };
  const [v, setV] = useState<typeof empty | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("departments")}
        hint={t("departmentsHint")}
        addLabel={t("addDepartment")}
        onAdd={() => setV(empty)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.departments.map((d) => (
          <Row key={d.id} muted={!d.isActive} onEdit={() => setV({ ...d })}>
            <span className="flex items-center gap-2 font-medium">
              {L(d.nameAr, d.nameEn)}
              {!d.isActive && <Badge variant="secondary">{t("off")}</Badge>}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("servicesCount", {
                n: data.services.filter((s) => s.departmentId === d.id && s.isActive).length,
              })}
            </span>
          </Row>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          title={v.id ? t("editDepartment") : t("addDepartment")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () => saveDepartmentAction(v),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="d-ar" label={t("nameAr")}>
              <Input
                id="d-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="d-en" label={t("nameEn")}>
              <Input
                id="d-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
          </div>
          <Check
            label={t("activeDepartment")}
            checked={v.isActive}
            onChange={(x) => setV({ ...v, isActive: x })}
          />
        </EditDialog>
      )}
    </div>
  );
}

// ─── Services ───────────────────────────────────────────────────────────────

function Services({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const deviceTypes = [...new Set(data.devices.map((d) => d.deviceType))].sort();
  const blank = {
    id: null as string | null,
    departmentId: data.departments.find((d) => d.isActive)?.id ?? data.departments[0]?.id ?? "",
    nameAr: "",
    nameEn: "",
    durationMinutes: 30,
    bufferMinutes: 0,
    price: "0",
    requiredDeviceType: "",
    consentCode: "",
    onlineBookable: false,
    isVirtual: false,
    isActive: true,
    preVisitAr: "",
    preVisitEn: "",
    postCareAr: "",
    postCareEn: "",
    recallAfterDays: "",
    doctorIds: [] as string[],
  };
  const [v, setV] = useState<typeof blank | null>(null);
  const open = (s: SetupData["services"][number]) =>
    setV({
      ...s,
      price: sar(s.priceHalalas),
      requiredDeviceType: s.requiredDeviceType ?? "",
      consentCode: s.consentCode ?? "",
      preVisitAr: s.preVisitAr ?? "",
      preVisitEn: s.preVisitEn ?? "",
      postCareAr: s.postCareAr ?? "",
      postCareEn: s.postCareEn ?? "",
      recallAfterDays: s.recallAfterDays?.toString() ?? "",
    });
  const doctorName = (id: string) => {
    const d = data.doctors.find((x) => x.id === id);
    return d ? L(d.name, d.nameEn) : "";
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("services")}
        hint={t("servicesHint")}
        addLabel={t("addService")}
        onAdd={() => setV(blank)}
      />
      <FormSuccess message={msg} />
      {data.departments.map((d) => {
        const list = data.services.filter((s) => s.departmentId === d.id);
        if (!list.length) return null;
        return (
          <section key={d.id} className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-sm font-semibold">{L(d.nameAr, d.nameEn)}</h3>
            <ListCard empty={t("none")}>
              {list.map((s) => (
                <Row key={s.id} muted={!s.isActive} onEdit={() => open(s)}>
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {L(s.nameAr, s.nameEn)}
                    {!s.isActive && <Badge variant="secondary">{t("off")}</Badge>}
                    {s.onlineBookable && <Badge variant="outline">{t("online")}</Badge>}
                    {s.isVirtual && <Badge variant="outline">{t("video")}</Badge>}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("serviceLine", { minutes: s.durationMinutes, price: sar(s.priceHalalas) })} ·{" "}
                    {s.doctorIds.length ? s.doctorIds.map(doctorName).join("، ") : t("allDoctors")}
                  </span>
                </Row>
              ))}
            </ListCard>
          </section>
        );
      })}
      {v && (
        <EditDialog
          wide
          title={v.id ? t("editService") : t("addService")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () =>
                saveServiceAction({
                  ...v,
                  priceSar: Number(v.price) || 0,
                  durationMinutes: Number(v.durationMinutes),
                  bufferMinutes: Number(v.bufferMinutes),
                  requiredDeviceType: v.requiredDeviceType || null,
                  consentCode: v.consentCode || null,
                  recallAfterDays: v.recallAfterDays ? Number(v.recallAfterDays) : null,
                }),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="s-ar" label={t("nameAr")}>
              <Input
                id="s-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="s-en" label={t("nameEn")}>
              <Input
                id="s-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <Field id="s-dept" label={t("department")}>
              <Select
                id="s-dept"
                value={v.departmentId}
                onChange={(e) => setV({ ...v, departmentId: e.target.value })}
              >
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {L(d.nameAr, d.nameEn)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="s-price" label={t("priceSar")}>
              <Input
                id="s-price"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={v.price}
                onChange={(e) => setV({ ...v, price: e.target.value })}
              />
            </Field>
            <Field id="s-dur" label={t("duration")}>
              <Input
                id="s-dur"
                type="number"
                min={5}
                max={480}
                step={5}
                dir="ltr"
                value={v.durationMinutes}
                onChange={(e) => setV({ ...v, durationMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field id="s-buf" label={t("buffer")} hint={t("bufferHint")}>
              <Input
                id="s-buf"
                type="number"
                min={0}
                max={120}
                step={5}
                dir="ltr"
                value={v.bufferMinutes}
                onChange={(e) => setV({ ...v, bufferMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field id="s-dev" label={t("device")} hint={t("deviceHint")}>
              <Select
                id="s-dev"
                value={v.requiredDeviceType}
                onChange={(e) => setV({ ...v, requiredDeviceType: e.target.value })}
              >
                <option value="">{t("noDevice")}</option>
                {deviceTypes.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="s-consent" label={t("consent")}>
              <Select
                id="s-consent"
                value={v.consentCode}
                onChange={(e) => setV({ ...v, consentCode: e.target.value })}
              >
                <option value="">{t("noConsent")}</option>
                {data.consents.map((c) => (
                  <option key={c.code} value={c.code}>
                    {L(c.titleAr, c.titleEn)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("doctors")}</legend>
            <p className="text-muted-foreground text-xs">{t("doctorsHint")}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {data.doctors.map((d) => (
                <Check
                  key={d.id}
                  label={L(d.name, d.nameEn)}
                  checked={v.doctorIds.includes(d.id)}
                  onChange={(x) =>
                    setV({
                      ...v,
                      doctorIds: x ? [...v.doctorIds, d.id] : v.doctorIds.filter((y) => y !== d.id),
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Check
              label={t("onlineBookable")}
              checked={v.onlineBookable}
              onChange={(x) => setV({ ...v, onlineBookable: x })}
            />
            <Check
              label={t("isVirtual")}
              checked={v.isVirtual}
              onChange={(x) => setV({ ...v, isVirtual: x })}
            />
            <Check
              label={t("activeService")}
              checked={v.isActive}
              onChange={(x) => setV({ ...v, isActive: x })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="s-pre-ar" label={t("preVisitAr")}>
              <Textarea
                id="s-pre-ar"
                dir="rtl"
                rows={3}
                value={v.preVisitAr}
                onChange={(e) => setV({ ...v, preVisitAr: e.target.value })}
              />
            </Field>
            <Field id="s-pre-en" label={t("preVisitEn")}>
              <Textarea
                id="s-pre-en"
                dir="ltr"
                rows={3}
                value={v.preVisitEn}
                onChange={(e) => setV({ ...v, preVisitEn: e.target.value })}
              />
            </Field>
            <Field id="s-post-ar" label={t("postCareAr")}>
              <Textarea
                id="s-post-ar"
                dir="rtl"
                rows={3}
                value={v.postCareAr}
                onChange={(e) => setV({ ...v, postCareAr: e.target.value })}
              />
            </Field>
            <Field id="s-post-en" label={t("postCareEn")}>
              <Textarea
                id="s-post-en"
                dir="ltr"
                rows={3}
                value={v.postCareEn}
                onChange={(e) => setV({ ...v, postCareEn: e.target.value })}
              />
            </Field>
            <Field id="s-recall" label={t("recallDays")} hint={t("recallHint")}>
              <Input
                id="s-recall"
                type="number"
                min={1}
                max={730}
                dir="ltr"
                value={v.recallAfterDays}
                onChange={(e) => setV({ ...v, recallAfterDays: e.target.value })}
              />
            </Field>
          </div>
        </EditDialog>
      )}
    </div>
  );
}

// ─── Rooms and devices ──────────────────────────────────────────────────────

function Rooms({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const room = useAction();
  const device = useAction();
  const { msg, saved } = useSaved();
  const firstBranch = data.branches[0]?.id ?? "";
  const [r, setR] = useState<{
    id: string | null;
    branchId: string;
    nameAr: string;
    nameEn: string;
    isVirtual: boolean;
    departmentId: string | null;
    isActive: boolean;
  } | null>(null);
  const [d, setD] = useState<{
    id: string | null;
    branchId: string;
    roomId: string;
    deviceType: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
  } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("rooms")}</h2>
          <p className="text-muted-foreground text-sm">{t("roomsHint")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              setR({
                id: null,
                branchId: firstBranch,
                nameAr: "",
                nameEn: "",
                isVirtual: false,
                departmentId: null,
                isActive: true,
              })
            }
            data-testid="setup-add"
          >
            <Plus />
            {t("addRoom")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setD({
                id: null,
                branchId: firstBranch,
                roomId: "",
                deviceType: "",
                nameAr: "",
                nameEn: "",
                isActive: true,
              })
            }
            data-testid="setup-add-device"
          >
            <Plus />
            {t("addDevice")}
          </Button>
        </div>
      </div>
      <FormSuccess message={msg} />
      {data.branches.map((b) => (
        <section key={b.id} className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm font-semibold">{L(b.nameAr, b.nameEn)}</h3>
          <ListCard empty={t("none")}>
            {[
              ...data.rooms
                .filter((x) => x.branchId === b.id)
                .map((x) => (
                  <Row key={x.id} muted={!x.isActive} onEdit={() => setR({ ...x })}>
                    <span className="flex items-center gap-2 font-medium">
                      {L(x.nameAr, x.nameEn)}
                      {x.isVirtual && <Badge variant="outline">{t("video")}</Badge>}
                      {x.departmentId && (
                        <Badge variant="outline">
                          {(() => {
                            const dep = data.departments.find((z) => z.id === x.departmentId);
                            return dep ? L(dep.nameAr, dep.nameEn) : "";
                          })()}
                        </Badge>
                      )}
                      {!x.isActive && <Badge variant="secondary">{t("off")}</Badge>}
                    </span>
                    <span className="text-muted-foreground text-xs">{t("room")}</span>
                  </Row>
                )),
              ...data.devices
                .filter((x) => x.branchId === b.id)
                .map((x) => (
                  <Row
                    key={x.id}
                    muted={!x.isActive}
                    onEdit={() => setD({ ...x, roomId: x.roomId ?? "" })}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {L(x.nameAr, x.nameEn)}
                      {!x.isActive && <Badge variant="secondary">{t("off")}</Badge>}
                    </span>
                    <span className="text-muted-foreground text-xs" dir="ltr">
                      {t("deviceLine", { type: x.deviceType })}
                    </span>
                  </Row>
                )),
            ]}
          </ListCard>
        </section>
      ))}
      {r && (
        <EditDialog
          title={r.id ? t("editRoom") : t("addRoom")}
          open
          onClose={() => setR(null)}
          pending={room.pending}
          error={room.error}
          onSave={() =>
            room.run(
              () => saveRoomAction({ ...r, departmentId: r.isVirtual ? null : r.departmentId }),
              () => {
                setR(null);
                saved();
              },
            )
          }
        >
          <Field id="r-branch" label={t("branch")}>
            <Select
              id="r-branch"
              value={r.branchId}
              onChange={(e) => setR({ ...r, branchId: e.target.value })}
            >
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {L(b.nameAr, b.nameEn)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="r-ar" label={t("nameAr")}>
              <Input
                id="r-ar"
                dir="rtl"
                required
                value={r.nameAr}
                onChange={(e) => setR({ ...r, nameAr: e.target.value })}
              />
            </Field>
            <Field id="r-en" label={t("nameEn")}>
              <Input
                id="r-en"
                dir="ltr"
                required
                value={r.nameEn}
                onChange={(e) => setR({ ...r, nameEn: e.target.value })}
              />
            </Field>
          </div>
          {!r.isVirtual && (
            <Field id="r-dept" label={t("roomDepartment")} hint={t("roomDepartmentHint")}>
              <Select
                id="r-dept"
                value={r.departmentId ?? ""}
                onChange={(e) => setR({ ...r, departmentId: e.target.value || null })}
                data-testid="room-department"
              >
                <option value="">{t("anyDepartment")}</option>
                {data.departments
                  .filter((x) => x.isActive)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {L(x.nameAr, x.nameEn)}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Check
            label={t("videoRoom")}
            checked={r.isVirtual}
            onChange={(x) => setR({ ...r, isVirtual: x })}
          />
          <Check
            label={t("activeRoom")}
            checked={r.isActive}
            onChange={(x) => setR({ ...r, isActive: x })}
          />
        </EditDialog>
      )}
      {d && (
        <EditDialog
          title={d.id ? t("editDevice") : t("addDevice")}
          open
          onClose={() => setD(null)}
          pending={device.pending}
          error={device.error}
          onSave={() =>
            device.run(
              () => saveDeviceAction({ ...d, roomId: d.roomId || null }),
              () => {
                setD(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="dv-branch" label={t("branch")}>
              <Select
                id="dv-branch"
                value={d.branchId}
                onChange={(e) => setD({ ...d, branchId: e.target.value, roomId: "" })}
              >
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {L(b.nameAr, b.nameEn)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="dv-room" label={t("deviceRoom")}>
              <Select
                id="dv-room"
                value={d.roomId}
                onChange={(e) => setD({ ...d, roomId: e.target.value })}
              >
                <option value="">{t("anyRoom")}</option>
                {data.rooms
                  .filter((x) => x.branchId === d.branchId && !x.isVirtual)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {L(x.nameAr, x.nameEn)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="dv-ar" label={t("nameAr")}>
              <Input
                id="dv-ar"
                dir="rtl"
                required
                value={d.nameAr}
                onChange={(e) => setD({ ...d, nameAr: e.target.value })}
              />
            </Field>
            <Field id="dv-en" label={t("nameEn")}>
              <Input
                id="dv-en"
                dir="ltr"
                required
                value={d.nameEn}
                onChange={(e) => setD({ ...d, nameEn: e.target.value })}
              />
            </Field>
          </div>
          <Field id="dv-type" label={t("deviceType")} hint={t("deviceTypeHint")}>
            <Input
              id="dv-type"
              dir="ltr"
              required
              value={d.deviceType}
              list="device-types"
              onChange={(e) => setD({ ...d, deviceType: e.target.value })}
            />
            <datalist id="device-types">
              {[...new Set(data.devices.map((x) => x.deviceType))].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </Field>
          <Check
            label={t("activeDevice")}
            checked={d.isActive}
            onChange={(x) => setD({ ...d, isActive: x })}
          />
        </EditDialog>
      )}
    </div>
  );
}

// ─── Packages ───────────────────────────────────────────────────────────────

function Packages({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const blank = {
    id: null as string | null,
    serviceId: data.services.find((s) => s.isActive)?.id ?? "",
    nameAr: "",
    nameEn: "",
    sessionsCount: 6,
    price: "0",
    validityDays: 365,
    isActive: true,
  };
  const [v, setV] = useState<typeof blank | null>(null);
  const svc = (id: string) => data.services.find((s) => s.id === id);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("packages")}
        hint={t("packagesHint")}
        addLabel={t("addPackage")}
        onAdd={() => setV(blank)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.packages.map((p) => (
          <Row
            key={p.id}
            muted={!p.isActive}
            onEdit={() => setV({ ...p, price: sar(p.priceHalalas) })}
          >
            <span className="flex items-center gap-2 font-medium">
              {L(p.nameAr, p.nameEn)}
              {!p.isActive && <Badge variant="secondary">{t("off")}</Badge>}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("packageLine", {
                service: L(svc(p.serviceId)?.nameAr, svc(p.serviceId)?.nameEn),
                sessions: p.sessionsCount,
                price: sar(p.priceHalalas),
                days: p.validityDays,
              })}
            </span>
          </Row>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          title={v.id ? t("editPackage") : t("addPackage")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () =>
                savePackageAction({
                  ...v,
                  priceSar: Number(v.price) || 0,
                  sessionsCount: Number(v.sessionsCount),
                  validityDays: Number(v.validityDays),
                }),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <Field id="p-svc" label={t("packageService")}>
            <Select
              id="p-svc"
              value={v.serviceId}
              onChange={(e) => setV({ ...v, serviceId: e.target.value })}
            >
              {data.services
                .filter((s) => s.isActive || s.id === v.serviceId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {L(s.nameAr, s.nameEn)}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="p-ar" label={t("nameAr")}>
              <Input
                id="p-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="p-en" label={t("nameEn")}>
              <Input
                id="p-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <Field id="p-n" label={t("sessions")}>
              <Input
                id="p-n"
                type="number"
                min={1}
                max={100}
                dir="ltr"
                value={v.sessionsCount}
                onChange={(e) => setV({ ...v, sessionsCount: Number(e.target.value) })}
              />
            </Field>
            <Field id="p-price" label={t("priceSar")}>
              <Input
                id="p-price"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={v.price}
                onChange={(e) => setV({ ...v, price: e.target.value })}
              />
            </Field>
            <Field id="p-days" label={t("validityDays")}>
              <Input
                id="p-days"
                type="number"
                min={1}
                max={3650}
                dir="ltr"
                value={v.validityDays}
                onChange={(e) => setV({ ...v, validityDays: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Check
            label={t("activePackage")}
            checked={v.isActive}
            onChange={(x) => setV({ ...v, isActive: x })}
          />
        </EditDialog>
      )}
    </div>
  );
}

// ─── Membership plans ───────────────────────────────────────────────────────

function Memberships({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const blank = {
    id: null as string | null,
    nameAr: "",
    nameEn: "",
    price: "0",
    periodMonths: 1,
    includedServiceId: null as string | null,
    includedVisits: 0,
    discountPercent: 10,
    isActive: true,
  };
  const [v, setV] = useState<typeof blank | null>(null);
  const svc = (id: string | null) => data.services.find((s) => s.id === id);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("memberships")}
        hint={t("membershipsHint")}
        addLabel={t("addMembership")}
        onAdd={() => setV(blank)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.memberships.map((p) => (
          <Row
            key={p.id}
            muted={!p.isActive}
            onEdit={() => setV({ ...p, price: sar(p.priceHalalas) })}
          >
            <span className="flex items-center gap-2 font-medium">
              {L(p.nameAr, p.nameEn)}
              {!p.isActive && <Badge variant="secondary">{t("off")}</Badge>}
            </span>
            <span className="text-muted-foreground text-xs" data-testid="membership-plan-line">
              {t("membershipLine", { price: sar(p.priceHalalas), months: p.periodMonths })}
              {p.includedVisits > 0 &&
                ` · ${t("membershipIncluded", {
                  n: p.includedVisits,
                  service: L(svc(p.includedServiceId)?.nameAr, svc(p.includedServiceId)?.nameEn),
                })}`}
              {p.discountPercent > 0 &&
                ` · ${t("membershipDiscount", { percent: p.discountPercent })}`}
            </span>
          </Row>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          title={v.id ? t("editMembership") : t("addMembership")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () =>
                saveMembershipPlanAction({
                  id: v.id,
                  nameAr: v.nameAr,
                  nameEn: v.nameEn,
                  priceSar: Number(v.price) || 0,
                  periodMonths: Number(v.periodMonths),
                  includedServiceId: v.includedVisits > 0 ? v.includedServiceId : null,
                  includedVisits: v.includedServiceId ? Number(v.includedVisits) : 0,
                  discountPercent: Number(v.discountPercent),
                  isActive: v.isActive,
                }),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="m-ar" label={t("nameAr")}>
              <Input
                id="m-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="m-en" label={t("nameEn")}>
              <Input
                id="m-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <Field id="m-price" label={t("priceSar")}>
              <Input
                id="m-price"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={v.price}
                onChange={(e) => setV({ ...v, price: e.target.value })}
              />
            </Field>
            <Field id="m-period" label={t("membershipPeriod")}>
              <Select
                id="m-period"
                value={v.periodMonths}
                onChange={(e) => setV({ ...v, periodMonths: Number(e.target.value) })}
              >
                {[1, 3, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    {t("months", { n })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="m-svc" label={t("membershipService")}>
              <Select
                id="m-svc"
                value={v.includedServiceId ?? ""}
                onChange={(e) =>
                  setV({
                    ...v,
                    includedServiceId: e.target.value || null,
                    includedVisits: e.target.value ? Math.max(1, v.includedVisits) : 0,
                  })
                }
              >
                <option value="">{t("noIncluded")}</option>
                {data.services
                  .filter((s) => s.isActive || s.id === v.includedServiceId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {L(s.nameAr, s.nameEn)}
                    </option>
                  ))}
              </Select>
            </Field>
            {v.includedServiceId && (
              <Field id="m-visits" label={t("membershipVisits")}>
                <Input
                  id="m-visits"
                  type="number"
                  min={1}
                  max={100}
                  dir="ltr"
                  value={v.includedVisits}
                  onChange={(e) => setV({ ...v, includedVisits: Number(e.target.value) })}
                />
              </Field>
            )}
            <Field id="m-disc" label={t("membershipDiscountLabel")}>
              <Input
                id="m-disc"
                type="number"
                min={0}
                max={50}
                dir="ltr"
                value={v.discountPercent}
                onChange={(e) => setV({ ...v, discountPercent: Number(e.target.value) })}
              />
            </Field>
          </div>
          <p className="text-muted-foreground text-xs">{t("membershipTermsCopied")}</p>
          <Check
            label={t("activeMembership")}
            checked={v.isActive}
            onChange={(x) => setV({ ...v, isActive: x })}
          />
        </EditDialog>
      )}
    </div>
  );
}

// ─── Consent forms ──────────────────────────────────────────────────────────

function Consents({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const blank = { titleAr: "", titleEn: "", bodyAr: "", bodyEn: "" };
  const [v, setV] = useState<typeof blank | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        title={t("consents")}
        hint={t("consentsHint")}
        addLabel={t("addConsent")}
        onAdd={() => setV(blank)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.consents.map((c) => (
          <li key={c.code} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{L(c.titleAr, c.titleEn)}</span>
              <span className="text-muted-foreground text-xs">
                {t("consentLine", {
                  version: c.version,
                  services: data.services.filter((s) => s.consentCode === c.code).length,
                })}
              </span>
            </div>
            <Link
              href="/settings?tab=consents"
              className="text-brand-strong text-sm font-medium underline"
            >
              {t("editTexts")}
            </Link>
          </li>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          wide
          title={t("addConsent")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () => createConsentFormAction(v),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="c-tar" label={t("titleAr")}>
              <Input
                id="c-tar"
                dir="rtl"
                required
                value={v.titleAr}
                onChange={(e) => setV({ ...v, titleAr: e.target.value })}
              />
            </Field>
            <Field id="c-ten" label={t("titleEn")}>
              <Input
                id="c-ten"
                dir="ltr"
                required
                value={v.titleEn}
                onChange={(e) => setV({ ...v, titleEn: e.target.value })}
              />
            </Field>
          </div>
          <Field id="c-bar" label={t("bodyAr")}>
            <Textarea
              id="c-bar"
              dir="rtl"
              rows={6}
              required
              value={v.bodyAr}
              onChange={(e) => setV({ ...v, bodyAr: e.target.value })}
            />
          </Field>
          <Field id="c-ben" label={t("bodyEn")}>
            <Textarea
              id="c-ben"
              dir="ltr"
              rows={6}
              required
              value={v.bodyEn}
              onChange={(e) => setV({ ...v, bodyEn: e.target.value })}
            />
          </Field>
          <p className="text-muted-foreground text-xs">{t("consentNewHint")}</p>
        </EditDialog>
      )}
    </div>
  );
}

// ─── Price list ─────────────────────────────────────────────────────────────

const KINDS = ["consumable", "product", "procedure", "other"] as const;

function Prices({ data }: { data: SetupData }) {
  const t = useTranslations("setup");
  const L = useL();
  const { run, pending, error } = useAction();
  const { msg, saved } = useSaved();
  const blank = {
    id: null as string | null,
    code: "",
    nameAr: "",
    nameEn: "",
    kind: "consumable" as (typeof KINDS)[number],
    price: "0",
    unitAr: "",
    unitEn: "",
    isActive: true,
  };
  const [v, setV] = useState<typeof blank | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="setup-prices">
      <Toolbar
        title={t("prices")}
        hint={t("pricesHint")}
        addLabel={t("addPrice")}
        onAdd={() => setV(blank)}
      />
      <FormSuccess message={msg} />
      <ListCard empty={t("none")}>
        {data.billingItems.map((b) => (
          <Row
            key={b.id}
            muted={!b.isActive}
            onEdit={() =>
              setV({
                ...b,
                price: sar(b.priceHalalas),
                unitAr: b.unitAr ?? "",
                unitEn: b.unitEn ?? "",
              })
            }
          >
            <span className="flex items-center gap-2 font-medium">
              <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                {b.code}
              </span>
              {L(b.nameAr, b.nameEn)}
              {!b.isActive && <Badge variant="secondary">{t("off")}</Badge>}
            </span>
            <span className="text-muted-foreground text-xs">
              {t(`kind.${b.kind}`)} · {sar(b.priceHalalas)} {t("sarPer")}{" "}
              {L(b.unitAr, b.unitEn) || t("each")}
            </span>
          </Row>
        ))}
      </ListCard>
      {v && (
        <EditDialog
          title={v.id ? t("editPrice") : t("addPrice")}
          open
          onClose={() => setV(null)}
          pending={pending}
          error={error}
          onSave={() =>
            run(
              () => saveBillingItemAction({ ...v, priceSar: Number(v.price) || 0 }),
              () => {
                setV(null);
                saved();
              },
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="bi-code" label={t("invoiceCode")}>
              <Input
                id="bi-code"
                dir="ltr"
                required
                value={v.code}
                onChange={(e) => setV({ ...v, code: e.target.value })}
              />
            </Field>
            <Field id="bi-kind" label={t("itemKind")}>
              <Select
                id="bi-kind"
                value={v.kind}
                onChange={(e) => setV({ ...v, kind: e.target.value as (typeof KINDS)[number] })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="bi-ar" label={t("nameAr")}>
              <Input
                id="bi-ar"
                dir="rtl"
                required
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            </Field>
            <Field id="bi-en" label={t("nameEn")}>
              <Input
                id="bi-en"
                dir="ltr"
                required
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <Field id="bi-price" label={t("priceSar")}>
              <Input
                id="bi-price"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={v.price}
                onChange={(e) => setV({ ...v, price: e.target.value })}
              />
            </Field>
            <Field id="bi-unit-ar" label={t("unitAr")}>
              <Input
                id="bi-unit-ar"
                dir="rtl"
                value={v.unitAr}
                onChange={(e) => setV({ ...v, unitAr: e.target.value })}
              />
            </Field>
            <Field id="bi-unit-en" label={t("unitEn")}>
              <Input
                id="bi-unit-en"
                dir="ltr"
                value={v.unitEn}
                onChange={(e) => setV({ ...v, unitEn: e.target.value })}
              />
            </Field>
          </div>
          <Check
            label={t("activePrice")}
            checked={v.isActive}
            onChange={(x) => setV({ ...v, isActive: x })}
          />
        </EditDialog>
      )}
    </div>
  );
}
