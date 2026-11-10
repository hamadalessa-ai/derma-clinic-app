import "server-only";
/**
 * Clinic set-up by the clinic admin: branches, departments, services (price, duration, doctors,
 * device, consent, online), rooms and devices, packages and new consent forms. One standard
 * platform; each clinic shapes it here. Every change is audited. Nothing a booking or a patient
 * record still uses is ever deleted: it is switched off (is_active) instead.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  branches,
  consentTemplates,
  departments,
  devices,
  packageTemplates,
  rooms,
  servicePractitioners,
  services,
  tenantMembers,
  users,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";

export class SetupError extends Error {
  constructor(
    public code:
      | "not_found"
      | "bad_department"
      | "bad_service"
      | "bad_branch"
      | "bad_room"
      | "bad_doctor"
      | "bad_consent"
      | "empty_text",
  ) {
    super(code);
  }
}

const tidy = (s: string | null | undefined) => (s ?? "").trim();
const orNull = (s: string | null | undefined) => tidy(s) || null;

/** A short code from an English name: letters and underscores only (e.g. "laser_hair_removal"). */
export function codeFrom(name: string, taken: Iterable<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (const c of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(`${base}_${c}`)) return `${base}_${c}`;
  }
  return `${base}_${Date.now()
    .toString(36)
    .replace(/[^a-z]/g, "")}`;
}

async function logChange(
  tx: TenantTx,
  actor: Actor,
  kind: string,
  id: string,
  created: boolean,
  metadata: Record<string, unknown>,
) {
  await audit(tx, {
    actorUserId: actor.userId,
    action: `setup.${kind}.${created ? "create" : "update"}`,
    entityType: kind,
    entityId: id,
    metadata,
  });
}

// ─── Read everything the set-up screen shows ────────────────────────────────

export async function loadSetup(tx: TenantTx) {
  // One after another: a transaction runs one query at a time.
  const b = await tx
    .select()
    .from(branches)
    .orderBy(asc(branches.sortOrder), asc(branches.createdAt));
  const d = await tx
    .select()
    .from(departments)
    .orderBy(asc(departments.sortOrder), asc(departments.createdAt));
  const s = await tx
    .select()
    .from(services)
    .orderBy(asc(services.sortOrder), asc(services.createdAt));
  const sp = await tx.select().from(servicePractitioners);
  const r = await tx.select().from(rooms).orderBy(asc(rooms.createdAt));
  const dv = await tx.select().from(devices).orderBy(asc(devices.createdAt));
  const p = await tx.select().from(packageTemplates).orderBy(asc(packageTemplates.createdAt));
  const c = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.isCurrent, true))
    .orderBy(asc(consentTemplates.createdAt));
  const docs = await tx
    .select({
      id: tenantMembers.id,
      name: users.name,
      nameEn: users.nameEn,
      roles: tenantMembers.roles,
      deactivatedAt: tenantMembers.deactivatedAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId));
  return {
    branches: b,
    departments: d,
    services: s.map((x) => ({
      ...x,
      doctorIds: sp.filter((y) => y.serviceId === x.id).map((y) => y.memberId),
    })),
    rooms: r,
    devices: dv,
    packages: p,
    consents: c.map((x) => ({
      code: x.code,
      titleAr: x.titleAr,
      titleEn: x.titleEn,
      version: x.version,
    })),
    doctors: docs
      .filter((m) => m.roles.includes("practitioner") && !m.deactivatedAt)
      .map((m) => ({ id: m.id, name: m.name, nameEn: m.nameEn })),
  };
}

// ─── Branches ───────────────────────────────────────────────────────────────

export interface BranchInput {
  id?: string | null;
  nameAr: string;
  nameEn: string;
  cityAr: string;
  cityEn: string;
  mapUrl?: string | null;
  sortOrder?: number;
}

export async function saveBranch(tx: TenantTx, actor: Actor, v: BranchInput) {
  assertCan(actor.roles, "setup:manage");
  const values = {
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    cityAr: tidy(v.cityAr),
    cityEn: tidy(v.cityEn),
    mapUrl: orNull(v.mapUrl),
    sortOrder: v.sortOrder ?? 0,
  };
  if (!values.nameAr || !values.nameEn || !values.cityAr || !values.cityEn)
    throw new SetupError("empty_text");
  if (v.id) {
    const [row] = await tx.update(branches).set(values).where(eq(branches.id, v.id)).returning();
    if (!row) throw new SetupError("not_found");
    await logChange(tx, actor, "branch", row.id, false, values);
    return row;
  }
  const [row] = await tx
    .insert(branches)
    .values({ tenantId: actor.tenantId, ...values })
    .returning();
  // Every branch starts with one consultation room (more under Rooms).
  await tx.insert(rooms).values({
    tenantId: actor.tenantId,
    branchId: row.id,
    nameAr: "غرفة الكشف 1",
    nameEn: "Consultation Room 1",
  });
  await logChange(tx, actor, "branch", row.id, true, values);
  return row;
}

// ─── Departments ────────────────────────────────────────────────────────────

export interface DepartmentInput {
  id?: string | null;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  sortOrder?: number;
}

export async function saveDepartment(tx: TenantTx, actor: Actor, v: DepartmentInput) {
  assertCan(actor.roles, "setup:manage");
  const values = {
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    isActive: v.isActive,
    sortOrder: v.sortOrder ?? 0,
  };
  if (!values.nameAr || !values.nameEn) throw new SetupError("empty_text");
  if (v.id) {
    const [row] = await tx
      .update(departments)
      .set(values)
      .where(eq(departments.id, v.id))
      .returning();
    if (!row) throw new SetupError("not_found");
    await logChange(tx, actor, "department", row.id, false, values);
    return row;
  }
  const taken = (await tx.select({ code: departments.code }).from(departments)).map((r) => r.code);
  const [row] = await tx
    .insert(departments)
    .values({ tenantId: actor.tenantId, code: codeFrom(values.nameEn, taken), ...values })
    .returning();
  await logChange(tx, actor, "department", row.id, true, values);
  return row;
}

// ─── Services ───────────────────────────────────────────────────────────────

export interface ServiceInput {
  id?: string | null;
  departmentId: string;
  nameAr: string;
  nameEn: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceHalalas: number;
  requiredDeviceType?: string | null;
  consentCode?: string | null;
  onlineBookable: boolean;
  isVirtual: boolean;
  isActive: boolean;
  preVisitAr?: string | null;
  preVisitEn?: string | null;
  postCareAr?: string | null;
  postCareEn?: string | null;
  recallAfterDays?: number | null;
  /** Empty = every doctor at the branch may do it. */
  doctorIds: string[];
}

export async function saveService(tx: TenantTx, actor: Actor, v: ServiceInput) {
  assertCan(actor.roles, "setup:manage");
  const [dept] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, v.departmentId));
  if (!dept) throw new SetupError("bad_department");
  const consentCode = orNull(v.consentCode);
  if (consentCode) {
    const [c] = await tx
      .select({ id: consentTemplates.id })
      .from(consentTemplates)
      .where(eq(consentTemplates.code, consentCode))
      .limit(1);
    if (!c) throw new SetupError("bad_consent");
  }
  const doctorIds = [...new Set(v.doctorIds)];
  if (doctorIds.length) {
    const found = await tx
      .select({ id: tenantMembers.id, roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(inArray(tenantMembers.id, doctorIds));
    if (found.length !== doctorIds.length || found.some((m) => !m.roles.includes("practitioner")))
      throw new SetupError("bad_doctor");
  }
  const values = {
    departmentId: v.departmentId,
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    durationMinutes: v.durationMinutes,
    bufferMinutes: v.bufferMinutes,
    priceHalalas: v.priceHalalas,
    requiredDeviceType: orNull(v.requiredDeviceType),
    consentCode,
    onlineBookable: v.onlineBookable,
    isVirtual: v.isVirtual,
    isActive: v.isActive,
    preVisitAr: orNull(v.preVisitAr),
    preVisitEn: orNull(v.preVisitEn),
    postCareAr: orNull(v.postCareAr),
    postCareEn: orNull(v.postCareEn),
    recallAfterDays: v.recallAfterDays ?? null,
    // Set by the clinic itself: a real price, not a demo value.
    isDemoValue: false,
  };
  if (!values.nameAr || !values.nameEn) throw new SetupError("empty_text");
  let row;
  if (v.id) {
    [row] = await tx.update(services).set(values).where(eq(services.id, v.id)).returning();
    if (!row) throw new SetupError("not_found");
  } else {
    const taken = (await tx.select({ code: services.code }).from(services)).map((r) => r.code);
    [row] = await tx
      .insert(services)
      .values({ tenantId: actor.tenantId, code: codeFrom(values.nameEn, taken), ...values })
      .returning();
  }
  // Which doctors do it: replace the list.
  await tx.delete(servicePractitioners).where(eq(servicePractitioners.serviceId, row.id));
  if (doctorIds.length) {
    await tx
      .insert(servicePractitioners)
      .values(
        doctorIds.map((memberId) => ({ tenantId: actor.tenantId, serviceId: row.id, memberId })),
      );
  }
  await logChange(tx, actor, "service", row.id, !v.id, { ...values, doctorIds });
  return row;
}

// ─── Rooms and devices ──────────────────────────────────────────────────────

export interface RoomInput {
  id?: string | null;
  branchId: string;
  nameAr: string;
  nameEn: string;
  isVirtual?: boolean;
  isActive: boolean;
}

async function assertBranch(tx: TenantTx, branchId: string) {
  const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
  if (!b) throw new SetupError("bad_branch");
}

export async function saveRoom(tx: TenantTx, actor: Actor, v: RoomInput) {
  assertCan(actor.roles, "setup:manage");
  await assertBranch(tx, v.branchId);
  const values = {
    branchId: v.branchId,
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    isVirtual: v.isVirtual ?? false,
    isActive: v.isActive,
  };
  if (!values.nameAr || !values.nameEn) throw new SetupError("empty_text");
  if (v.id) {
    const [row] = await tx.update(rooms).set(values).where(eq(rooms.id, v.id)).returning();
    if (!row) throw new SetupError("not_found");
    await logChange(tx, actor, "room", row.id, false, values);
    return row;
  }
  const [row] = await tx
    .insert(rooms)
    .values({ tenantId: actor.tenantId, ...values })
    .returning();
  await logChange(tx, actor, "room", row.id, true, values);
  return row;
}

export interface DeviceInput {
  id?: string | null;
  branchId: string;
  roomId?: string | null;
  deviceType: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

export async function saveDevice(tx: TenantTx, actor: Actor, v: DeviceInput) {
  assertCan(actor.roles, "setup:manage");
  await assertBranch(tx, v.branchId);
  if (v.roomId) {
    const [r] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, v.roomId), eq(rooms.branchId, v.branchId)));
    if (!r) throw new SetupError("bad_room");
  }
  const deviceType = tidy(v.deviceType)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const values = {
    branchId: v.branchId,
    roomId: v.roomId || null,
    deviceType,
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    isActive: v.isActive,
  };
  if (!values.nameAr || !values.nameEn || !deviceType) throw new SetupError("empty_text");
  if (v.id) {
    const [row] = await tx.update(devices).set(values).where(eq(devices.id, v.id)).returning();
    if (!row) throw new SetupError("not_found");
    await logChange(tx, actor, "device", row.id, false, values);
    return row;
  }
  const [row] = await tx
    .insert(devices)
    .values({ tenantId: actor.tenantId, ...values })
    .returning();
  await logChange(tx, actor, "device", row.id, true, values);
  return row;
}

// ─── Packages ───────────────────────────────────────────────────────────────

export interface PackageInput {
  id?: string | null;
  serviceId: string;
  nameAr: string;
  nameEn: string;
  sessionsCount: number;
  priceHalalas: number;
  validityDays: number;
  isActive: boolean;
}

export async function savePackage(tx: TenantTx, actor: Actor, v: PackageInput) {
  assertCan(actor.roles, "setup:manage");
  const [svc] = await tx
    .select({ id: services.id })
    .from(services)
    .where(eq(services.id, v.serviceId));
  if (!svc) throw new SetupError("bad_service");
  const values = {
    serviceId: v.serviceId,
    nameAr: tidy(v.nameAr),
    nameEn: tidy(v.nameEn),
    sessionsCount: v.sessionsCount,
    priceHalalas: v.priceHalalas,
    validityDays: v.validityDays,
    isActive: v.isActive,
  };
  if (!values.nameAr || !values.nameEn) throw new SetupError("empty_text");
  if (v.id) {
    const [row] = await tx
      .update(packageTemplates)
      .set(values)
      .where(eq(packageTemplates.id, v.id))
      .returning();
    if (!row) throw new SetupError("not_found");
    await logChange(tx, actor, "package", row.id, false, values);
    return row;
  }
  const [row] = await tx
    .insert(packageTemplates)
    .values({ tenantId: actor.tenantId, ...values })
    .returning();
  await logChange(tx, actor, "package", row.id, true, values);
  return row;
}

// ─── New consent form (texts and rules are edited in Settings → Consent forms) ─

export async function createConsentForm(
  tx: TenantTx,
  actor: Actor,
  v: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string },
) {
  assertCan(actor.roles, "setup:manage");
  assertCan(actor.roles, "consents:templates");
  const clean = {
    titleAr: tidy(v.titleAr),
    titleEn: tidy(v.titleEn),
    bodyAr: tidy(v.bodyAr),
    bodyEn: tidy(v.bodyEn),
  };
  if (Object.values(clean).some((x) => !x)) throw new SetupError("empty_text");
  const taken = (
    await tx.selectDistinct({ code: consentTemplates.code }).from(consentTemplates)
  ).map((r) => r.code);
  const code = codeFrom(clean.titleEn, taken).slice(0, 40);
  const [row] = await tx
    .insert(consentTemplates)
    .values({
      tenantId: actor.tenantId,
      code,
      version: 1,
      isCurrent: true,
      ...clean,
      createdBy: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "setup.consent.create",
    entityType: "consent_template",
    entityId: row.id,
    metadata: { code, title: clean.titleEn },
  });
  return row;
}

/** Device types already used by the clinic (for the service form's list). */
export async function deviceTypes(tx: TenantTx) {
  const rows = await tx
    .selectDistinct({ t: devices.deviceType })
    .from(devices)
    .orderBy(sql`1`);
  return rows.map((r) => r.t);
}
