"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Link2, UserPlus } from "lucide-react";
import {
  addTeamMemberAction,
  inviteLinkAction,
  linkWebsiteDoctorAction,
  setTeamMemberActiveAction,
  updateTeamMemberAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Role = "clinic_admin" | "practitioner" | "receptionist";
const ROLES: Role[] = ["clinic_admin", "practitioner", "receptionist"];

export interface TeamMember {
  id: string;
  userId: string;
  nameAr: string;
  nameEn: string | null;
  email: string;
  roles: Role[];
  branchId: string | null;
  gender: "male" | "female" | null;
  titleAr: string | null;
  titleEn: string | null;
  deactivatedAt: string | null;
  invited: boolean;
  websiteDoctor: number;
}
export interface WebsiteDoctor {
  index: number;
  nameAr: string;
  nameEn: string;
  titleAr: string;
  titleEn: string;
  memberId: string | null;
}

/** Settings → Team: staff list, add someone (invitation link), roles, deactivate, website link. */
export function TeamSettings({
  members,
  websiteDoctors,
  branches,
  selfId,
}: {
  members: TeamMember[];
  websiteDoctors: WebsiteDoctor[];
  branches: { id: string; name: string }[];
  selfId: string | null;
}) {
  const t = useTranslations("team");
  const tr = useTranslations("roles");
  const ar = useLocale() === "ar";
  const nm = (a: string, e: string | null) => (ar ? a : e || a);
  const [invite, setInvite] = useState<{ name: string; url: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const active = members.filter((m) => !m.deactivatedAt);
  const former = members.filter((m) => m.deactivatedAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-xl text-sm">{t("intro")}</p>
        {!adding && (
          <Button onClick={() => setAdding(true)} data-testid="team-add">
            <UserPlus />
            {t("add")}
          </Button>
        )}
      </div>

      {invite && <InviteLink name={invite.name} url={invite.url} onClose={() => setInvite(null)} />}

      {adding && (
        <AddMember
          branches={branches}
          websiteDoctors={websiteDoctors.filter((d) => !d.memberId)}
          onDone={(r) => {
            setAdding(false);
            if (r) setInvite(r);
          }}
        />
      )}

      <ul className="divide-y rounded-xl border">
        {active.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            self={m.id === selfId}
            branches={branches}
            websiteDoctors={websiteDoctors}
            onInvite={setInvite}
            nm={nm}
            tr={tr}
          />
        ))}
      </ul>

      {former.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm font-semibold">{t("former")}</h3>
          <ul className="divide-y rounded-xl border">
            {former.map((m) => (
              <MemberRow
                key={m.id}
                m={m}
                self={false}
                branches={branches}
                websiteDoctors={websiteDoctors}
                onInvite={setInvite}
                nm={nm}
                tr={tr}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberRow({
  m,
  self,
  branches,
  websiteDoctors,
  onInvite,
  nm,
  tr,
}: {
  m: TeamMember;
  self: boolean;
  branches: { id: string; name: string }[];
  websiteDoctors: WebsiteDoctor[];
  onInvite: (v: { name: string; url: string }) => void;
  nm: (a: string, e: string | null) => string;
  tr: (k: Role) => string;
}) {
  const t = useTranslations("team");
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<Role[]>(m.roles);
  const [branchId, setBranchId] = useState(m.branchId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const off = !!m.deactivatedAt;
  const doctor = m.roles.includes("practitioner");
  const branchName = branches.find((b) => b.id === m.branchId)?.name ?? t("allBranches");

  return (
    <li className="flex flex-col gap-3 p-4" data-testid="team-member">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{nm(m.nameAr, m.nameEn)}</span>
            {off ? (
              <Badge variant="secondary">{t("deactivated")}</Badge>
            ) : m.invited ? (
              <Badge variant="gold">{t("invited")}</Badge>
            ) : null}
            {self && <Badge variant="outline">{t("you")}</Badge>}
          </div>
          <div className="text-muted-foreground text-sm" dir="ltr">
            {m.email}
          </div>
          <div className="text-muted-foreground text-sm">
            {m.roles.map((r) => tr(r)).join(" · ")} · {branchName}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!off && m.invited && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => inviteLinkAction({ userId: m.userId }),
                  (r) => onInvite({ name: nm(m.nameAr, m.nameEn), url: r.inviteUrl }),
                )
              }
            >
              <Link2 />
              {t("inviteLink")}
            </Button>
          )}
          {!off && (
            <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
              {t("edit")}
            </Button>
          )}
          {!self && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                (off || window.confirm(t("confirmDeactivate"))) &&
                run(() => setTeamMemberActiveAction({ memberId: m.id, active: off }))
              }
              data-testid="team-toggle"
            >
              {off ? t("reactivate") : t("deactivate")}
            </Button>
          )}
        </div>
      </div>

      {!off && doctor && websiteDoctors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Label htmlFor={`web-${m.id}`} className="text-muted-foreground">
            {t("websiteProfile")}
          </Label>
          <Select
            id={`web-${m.id}`}
            className="h-9 max-w-xs"
            value={m.websiteDoctor >= 0 ? String(m.websiteDoctor) : ""}
            disabled={pending}
            onChange={(e) =>
              run(
                () =>
                  linkWebsiteDoctorAction({
                    memberId: m.id,
                    websiteDoctor: e.target.value === "" ? null : Number(e.target.value),
                  }),
                () => setMsg(t("linked")),
              )
            }
            data-testid="team-website-link"
          >
            <option value="">{t("notOnWebsite")}</option>
            {websiteDoctors
              .filter((d) => !d.memberId || d.memberId === m.id)
              .map((d) => (
                <option key={d.index} value={d.index}>
                  {nm(d.nameAr, d.nameEn)}
                </option>
              ))}
          </Select>
        </div>
      )}

      {editing && (
        <form
          className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateTeamMemberAction({
                  memberId: m.id,
                  roles,
                  branchId: branchId || null,
                  gender: m.gender,
                  titleAr: m.titleAr,
                  titleEn: m.titleEn,
                }),
              () => {
                setEditing(false);
                setMsg(t("saved"));
              },
            );
          }}
        >
          <RolePicker roles={roles} setRoles={setRoles} tr={tr} />
          <BranchPicker id={`b-${m.id}`} value={branchId} onChange={setBranchId} branches={branches} />
          <Button type="submit" size="sm" className="self-start" loading={pending}>
            {t("save")}
          </Button>
        </form>
      )}
      <FormError message={error} />
      <FormSuccess message={msg} />
    </li>
  );
}

function AddMember({
  branches,
  websiteDoctors,
  onDone,
}: {
  branches: { id: string; name: string }[];
  websiteDoctors: WebsiteDoctor[];
  onDone: (invite: { name: string; url: string } | null) => void;
}) {
  const t = useTranslations("team");
  const tr = useTranslations("roles");
  const ar = useLocale() === "ar";
  const { run, pending, error } = useAction();
  const [web, setWeb] = useState("");
  const [v, setV] = useState({
    nameAr: "",
    nameEn: "",
    email: "",
    titleAr: "",
    titleEn: "",
    branchId: "",
    gender: "" as "" | "male" | "female",
  });
  const [roles, setRoles] = useState<Role[]>(["practitioner"]);
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4"
      data-testid="team-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addTeamMemberAction({
              nameAr: v.nameAr,
              nameEn: v.nameEn || null,
              email: v.email,
              roles,
              branchId: v.branchId || null,
              gender: v.gender || null,
              titleAr: v.titleAr || null,
              titleEn: v.titleEn || null,
              websiteDoctor: web === "" ? null : Number(web),
            }),
          (r) => onDone(r.inviteUrl ? { name: ar ? v.nameAr : v.nameEn || v.nameAr, url: r.inviteUrl } : null),
        );
      }}
    >
      {websiteDoctors.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="from-web">{t("fromWebsite")}</Label>
          <Select
            id="from-web"
            value={web}
            onChange={(e) => {
              setWeb(e.target.value);
              const d = websiteDoctors.find((x) => String(x.index) === e.target.value);
              if (d) {
                setRoles(["practitioner"]);
                setV({
                  ...v,
                  nameAr: d.nameAr,
                  nameEn: d.nameEn,
                  titleAr: d.titleAr,
                  titleEn: d.titleEn,
                });
              }
            }}
          >
            <option value="">{t("fromWebsiteNone")}</option>
            {websiteDoctors.map((d) => (
              <option key={d.index} value={d.index}>
                {ar ? d.nameAr : d.nameEn}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="n-ar" label={t("nameAr")} value={v.nameAr} onChange={(x) => set("nameAr", x)} dir="rtl" required />
        <Field id="n-en" label={t("nameEn")} value={v.nameEn} onChange={(x) => set("nameEn", x)} dir="ltr" />
        <Field id="t-ar" label={t("titleAr")} value={v.titleAr} onChange={(x) => set("titleAr", x)} dir="rtl" />
        <Field id="t-en" label={t("titleEn")} value={v.titleEn} onChange={(x) => set("titleEn", x)} dir="ltr" />
        <Field
          id="email"
          label={t("email")}
          value={v.email}
          onChange={(x) => set("email", x)}
          dir="ltr"
          type="email"
          required
        />
        <BranchPicker id="branch" value={v.branchId} onChange={(x) => set("branchId", x)} branches={branches} />
      </div>
      <RolePicker roles={roles} setRoles={setRoles} tr={tr} />
      <p className="text-muted-foreground text-xs">{t("addHint")}</p>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending} data-testid="team-add-save">
          {t("addSave")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function InviteLink({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const t = useTranslations("team");
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-gold flex flex-col gap-3 rounded-xl p-4" data-testid="team-invite-link">
      <div className="font-semibold">{t("inviteTitle", { name })}</div>
      <p className="text-sm">{t("inviteText")}</p>
      <Input readOnly value={url} dir="ltr" onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("copied") : t("copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}

function RolePicker({
  roles,
  setRoles,
  tr,
}: {
  roles: Role[];
  setRoles: (r: Role[]) => void;
  tr: (k: Role) => string;
}) {
  return (
    <fieldset className="flex flex-wrap gap-4">
      {ROLES.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-brand size-4"
            checked={roles.includes(r)}
            onChange={(e) =>
              setRoles(
                e.target.checked
                  ? [...roles, r]
                  : roles.length > 1
                    ? roles.filter((x) => x !== r)
                    : roles,
              )
            }
          />
          {tr(r)}
        </label>
      ))}
    </fieldset>
  );
}

function BranchPicker({
  id,
  value,
  onChange,
  branches,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  branches: { id: string; name: string }[];
}) {
  const t = useTranslations("team");
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{t("branch")}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("allBranches")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  dir,
  type = "text",
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  dir: "rtl" | "ltr";
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        dir={dir}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
