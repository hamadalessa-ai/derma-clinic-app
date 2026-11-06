import "server-only";
/**
 * Settings → Team: the clinic's staff. Admins add people (an invitation link lets them set their
 * own password), change roles / branch / title, deactivate someone who left (no sign-in, not
 * bookable, history kept), and link a doctor to their profile on the clinic website so the
 * website's "Book" button books that doctor. Every change is audited.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  accounts,
  branches,
  staffSchedules,
  tenantMembers,
  tenantSettings,
  users,
  type SiteContent,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan, type Role } from "@/lib/auth/permissions";

export class TeamError extends Error {
  constructor(
    public code:
      | "already_member"
      | "not_found"
      | "last_admin"
      | "self"
      | "invite_invalid"
      | "password_already_set",
  ) {
    super(code);
  }
}

type ClinicRole = Exclude<Role, "platform_owner">;

export interface MemberInput {
  nameAr: string;
  nameEn?: string | null;
  email: string;
  roles: ClinicRole[];
  branchId: string | null;
  gender?: "male" | "female" | null;
  titleAr?: string | null;
  titleEn?: string | null;
  /** Index in site.doctors of the website profile to link (a doctor). */
  websiteDoctor?: number | null;
}

/** Everyone in the clinic with their sign-in state and website link. */
export async function listTeam(tx: TenantTx) {
  const rows = await tx
    .select({
      id: tenantMembers.id,
      userId: users.id,
      nameAr: users.name,
      nameEn: users.nameEn,
      email: users.email,
      roles: tenantMembers.roles,
      branchId: tenantMembers.branchId,
      gender: tenantMembers.gender,
      titleAr: tenantMembers.titleAr,
      titleEn: tenantMembers.titleEn,
      deactivatedAt: tenantMembers.deactivatedAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .orderBy(asc(tenantMembers.createdAt));
  const withPassword = new Set(
    (
      await tx
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(eq(accounts.providerId, "credential"))
    ).map((a) => a.userId),
  );
  const [s] = await tx.select({ site: tenantSettings.site }).from(tenantSettings).limit(1);
  const site = (s?.site ?? {}) as SiteContent;
  return {
    members: rows.map((m) => ({
      ...m,
      invited: !withPassword.has(m.userId),
      websiteDoctor: (site.doctors ?? []).findIndex((d) => d.memberId === m.id),
    })),
    websiteDoctors: (site.doctors ?? []).map((d, i) => ({
      index: i,
      nameAr: d.nameAr,
      nameEn: d.nameEn,
      titleAr: d.titleAr,
      titleEn: d.titleEn,
      memberId: d.memberId ?? null,
    })),
  };
}

/**
 * Adds someone to the clinic. A new email gets a user without a password (they set it from the
 * invitation link); an existing account just joins this clinic. Doctors get the clinic's usual
 * weekly hours (Sun–Thu 10:00–20:00) at their branch, editable on Working hours.
 * Returns the member id and the user id (for the invitation link) when a password is still needed.
 */
export async function addMember(tx: TenantTx, actor: Actor, input: MemberInput) {
  assertCan(actor.roles, "team:manage");
  const email = input.email.trim().toLowerCase();
  let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const [already] = await tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1);
    if (already) throw new TeamError("already_member");
  } else {
    [user] = await tx
      .insert(users)
      .values({
        id: `usr_${randomUUID().replace(/-/g, "")}`,
        name: input.nameAr.trim(),
        nameEn: input.nameEn?.trim() || null,
        email,
        emailVerified: false,
      })
      .returning();
  }
  const [member] = await tx
    .insert(tenantMembers)
    .values({
      tenantId: actor.tenantId,
      userId: user.id,
      roles: input.roles,
      branchId: input.branchId,
      gender: input.gender ?? null,
      titleAr: input.titleAr?.trim() || null,
      titleEn: input.titleEn?.trim() || null,
    })
    .returning();

  if (input.roles.includes("practitioner")) {
    const branchId =
      input.branchId ??
      (
        await tx
          .select({ id: branches.id })
          .from(branches)
          .orderBy(asc(branches.sortOrder))
          .limit(1)
      )[0]?.id;
    if (branchId) {
      await tx.insert(staffSchedules).values(
        [0, 1, 2, 3, 4].map((weekday) => ({
          tenantId: actor.tenantId,
          memberId: member.id,
          branchId,
          weekday,
          startTime: "10:00",
          endTime: "20:00",
        })),
      );
    }
  }
  if (input.websiteDoctor !== null && input.websiteDoctor !== undefined) {
    await writeLink(tx, member.id, input.websiteDoctor);
  }
  const [cred] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
    .limit(1);
  await audit(tx, {
    actorUserId: actor.userId,
    action: "staff.add",
    entityType: "tenant_member",
    entityId: member.id,
    metadata: {
      roles: input.roles,
      branchId: input.branchId,
      websiteDoctor: input.websiteDoctor ?? null,
    },
  });
  return { memberId: member.id, userId: user.id, needsPassword: !cred };
}

/** Roles, branch and title. The clinic always keeps at least one active admin. */
export async function updateMember(
  tx: TenantTx,
  actor: Actor,
  memberId: string,
  input: Pick<MemberInput, "roles" | "branchId" | "titleAr" | "titleEn" | "gender">,
) {
  assertCan(actor.roles, "team:manage");
  const member = await one(tx, memberId);
  if (member.roles.includes("clinic_admin") && !input.roles.includes("clinic_admin"))
    await keepOneAdmin(tx, memberId);
  await tx
    .update(tenantMembers)
    .set({
      roles: input.roles,
      branchId: input.branchId,
      gender: input.gender ?? null,
      titleAr: input.titleAr?.trim() || null,
      titleEn: input.titleEn?.trim() || null,
    })
    .where(eq(tenantMembers.id, memberId));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "staff.update",
    entityType: "tenant_member",
    entityId: memberId,
    metadata: { roles: input.roles, branchId: input.branchId },
  });
}

/** Someone left: no sign-in, not bookable, removed from the website link. History stays. */
export async function setActive(tx: TenantTx, actor: Actor, memberId: string, active: boolean) {
  assertCan(actor.roles, "team:manage");
  const member = await one(tx, memberId);
  if (!active) {
    if (member.id === actor.memberId) throw new TeamError("self");
    if (member.roles.includes("clinic_admin")) await keepOneAdmin(tx, memberId);
  }
  await tx
    .update(tenantMembers)
    .set({ deactivatedAt: active ? null : new Date() })
    .where(eq(tenantMembers.id, memberId));
  if (!active) await writeLink(tx, memberId, null);
  await audit(tx, {
    actorUserId: actor.userId,
    action: active ? "staff.reactivate" : "staff.deactivate",
    entityType: "tenant_member",
    entityId: memberId,
  });
}

/** Links a doctor to a profile on the clinic website (or removes the link with null). */
export async function linkWebsiteDoctor(
  tx: TenantTx,
  actor: Actor,
  memberId: string,
  websiteDoctor: number | null,
) {
  assertCan(actor.roles, "team:manage");
  const member = await one(tx, memberId);
  if (!member.roles.includes("practitioner") && websiteDoctor !== null)
    throw new TeamError("not_found");
  await writeLink(tx, memberId, websiteDoctor);
  await audit(tx, {
    actorUserId: actor.userId,
    action: "staff.website_link",
    entityType: "tenant_member",
    entityId: memberId,
    metadata: { websiteDoctor },
  });
}

/**
 * The invited person sets their password (from the invitation link). Only for members of this
 * clinic who have no password yet.
 */
export async function setInvitedPassword(tx: TenantTx, userId: string, password: string) {
  const [member] = await tx
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), isNull(tenantMembers.deactivatedAt)))
    .limit(1);
  if (!member) throw new TeamError("invite_invalid");
  const [cred] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1);
  if (cred) throw new TeamError("password_already_set");
  await tx.insert(accounts).values({
    id: `acc_${randomUUID().replace(/-/g, "")}`,
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(password, 10),
  });
  await tx.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  await audit(tx, {
    actorUserId: userId,
    action: "staff.password_set",
    entityType: "tenant_member",
    entityId: member.id,
  });
}

/** Who an invitation is for (name and email), when it is still open. */
export async function inviteInfo(tx: TenantTx, userId: string) {
  const [row] = await tx
    .select({ name: users.name, nameEn: users.nameEn, email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.userId, userId), isNull(tenantMembers.deactivatedAt)))
    .limit(1);
  if (!row) return null;
  const [cred] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1);
  return { ...row, passwordSet: !!cred };
}

async function one(tx: TenantTx, memberId: string) {
  const [m] = await tx.select().from(tenantMembers).where(eq(tenantMembers.id, memberId)).limit(1);
  if (!m) throw new TeamError("not_found");
  return m;
}

async function keepOneAdmin(tx: TenantTx, leaving: string) {
  const admins = (
    await tx
      .select({ id: tenantMembers.id, roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(isNull(tenantMembers.deactivatedAt))
  ).filter((m) => m.roles.includes("clinic_admin") && m.id !== leaving);
  if (!admins.length) throw new TeamError("last_admin");
}

/** One website profile per doctor: sets memberId on that profile and clears it elsewhere. */
async function writeLink(tx: TenantTx, memberId: string, index: number | null) {
  const [s] = await tx.select({ site: tenantSettings.site }).from(tenantSettings).limit(1);
  const site = (s?.site ?? {}) as SiteContent;
  if (!site.doctors) return;
  if (index !== null && !site.doctors[index]) throw new TeamError("not_found");
  const doctors = site.doctors.map((d, i) => {
    const { memberId: current, ...rest } = d;
    if (i === index) return { ...rest, memberId };
    return current && current !== memberId ? { ...rest, memberId: current } : rest;
  });
  await tx.update(tenantSettings).set({ site: { ...site, doctors } });
}
