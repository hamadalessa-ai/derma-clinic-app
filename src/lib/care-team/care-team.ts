/**
 * Care team: a nurse / assistant works with one or more doctors (table care_team). She sees their
 * day, opens their visit screen and prepares their notes in the doctor's name; the database's
 * own rules (app_assists in db/rls.sql) decide which notes she can see or prepare.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { careTeam, tenantMembers, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan, can } from "@/lib/auth/permissions";

export class CareTeamError extends Error {
  constructor(public code: "not_assistant" | "not_doctor" | "not_found") {
    super(code);
    this.name = "CareTeamError";
  }
}

export interface AssistedDoctor {
  memberId: string;
  userId: string;
  name: string;
  nameEn: string | null;
}

/** The (active) doctors this nurse / assistant works with. Empty for everyone else. */
export async function assistedDoctors(tx: TenantTx, actor: Actor): Promise<AssistedDoctor[]> {
  if (!actor.memberId || !can(actor.roles, "visits:assist")) return [];
  return tx
    .select({
      memberId: tenantMembers.id,
      userId: tenantMembers.userId,
      name: users.name,
      nameEn: users.nameEn,
    })
    .from(careTeam)
    .innerJoin(tenantMembers, eq(tenantMembers.id, careTeam.practitionerMemberId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(eq(careTeam.assistantMemberId, actor.memberId), isNull(tenantMembers.deactivatedAt)),
    );
}

/** Does this actor assist the doctor with this clinic membership? */
export async function assistsMember(tx: TenantTx, actor: Actor, practitionerMemberId: string) {
  return (await assistedDoctors(tx, actor)).some((d) => d.memberId === practitionerMemberId);
}

/** Does this actor assist the doctor with this user id (notes are stored by user id)? */
export async function assistsUser(tx: TenantTx, actor: Actor, doctorUserId: string) {
  return (await assistedDoctors(tx, actor)).some((d) => d.userId === doctorUserId);
}

/** The doctor behind a clinic membership: user id and name (the note's author). */
export async function doctorOf(tx: TenantTx, memberId: string) {
  const [d] = await tx
    .select({ userId: tenantMembers.userId, name: users.name, nameEn: users.nameEn })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.id, memberId))
    .limit(1);
  if (!d) throw new CareTeamError("not_found");
  return d;
}

/** Settings → Team: which doctors this nurse / assistant works with (replaces the list). */
export async function setCareTeam(
  tx: TenantTx,
  actor: Actor,
  assistantMemberId: string,
  doctorMemberIds: string[],
) {
  assertCan(actor.roles, "team:manage");
  const [assistant] = await tx
    .select({ roles: tenantMembers.roles })
    .from(tenantMembers)
    .where(eq(tenantMembers.id, assistantMemberId))
    .limit(1);
  if (!assistant) throw new CareTeamError("not_found");
  const ids = [...new Set(doctorMemberIds)];
  if (ids.length && !assistant.roles.includes("assistant")) throw new CareTeamError("not_assistant");
  if (ids.length) {
    const doctors = await tx
      .select({ id: tenantMembers.id, roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(inArray(tenantMembers.id, ids));
    if (doctors.length !== ids.length || doctors.some((d) => !d.roles.includes("practitioner"))) {
      throw new CareTeamError("not_doctor");
    }
  }
  await tx.delete(careTeam).where(eq(careTeam.assistantMemberId, assistantMemberId));
  if (ids.length) {
    await tx.insert(careTeam).values(
      ids.map((practitionerMemberId) => ({
        tenantId: actor.tenantId,
        assistantMemberId,
        practitionerMemberId,
      })),
    );
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "team.care_team",
    entityType: "tenant_member",
    entityId: assistantMemberId,
    metadata: { doctors: ids.length },
  });
  return { doctors: ids.length };
}

/** For Settings → Team: every nurse / assistant → her doctors' member ids. */
export async function careTeamMap(tx: TenantTx) {
  const rows = await tx.select().from(careTeam);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    map.set(r.assistantMemberId, [...(map.get(r.assistantMemberId) ?? []), r.practitionerMemberId]);
  }
  return map;
}
