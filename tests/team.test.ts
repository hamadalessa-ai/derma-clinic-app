/**
 * Settings → Team: admins add staff (invitation link → they set their own password), deactivate
 * people who left (no sign-in, not bookable), and link doctors to their website profile.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { branches, staffSchedules, tenantSettings, type SiteContent } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { canSignInToClinic, getStaffAccess } from "@/lib/auth/access";
import { branchPractitioners } from "@/lib/booking/engine";
import { inviteToken, parseInviteToken } from "@/lib/team/invite";
import {
  addMember,
  inviteInfo,
  linkWebsiteDoctor,
  setActive,
  setInvitedPassword,
  TeamError,
} from "@/lib/team/team";
import { admin, DERMA, LAMSA, lamsaAdmin, member, reception } from "./fixtures";

afterAll(closeDb);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof TeamError) return e.code;
    throw e;
  }
  return "ok";
};
const stamp = Date.now();

describe("invitation links", () => {
  it("are bound to one clinic and one person, and expire", () => {
    const tok = inviteToken(DERMA, "usr_abc123");
    expect(parseInviteToken(DERMA, tok)).toBe("usr_abc123");
    expect(parseInviteToken(LAMSA, tok)).toBeNull();
    expect(parseInviteToken(DERMA, tok.replace("usr_abc123", "usr_abc124"))).toBeNull();
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect(parseInviteToken(DERMA, tok, later)).toBeNull();
  });
});

describe("team", () => {
  it("only admins add staff", async () => {
    expect(
      await withActor(reception, (tx) =>
        addMember(tx, reception, {
          nameAr: "س",
          email: `x${stamp}@t.demo`,
          roles: ["receptionist"],
          branchId: null,
        }).then(
          () => "ok",
          () => "refused",
        ),
      ),
    ).toBe("refused");
  });

  it("a new doctor: invitation, own password, bookable with default hours; deactivated → gone", async () => {
    const branch = await withTenant(LAMSA, async (tx) => (await tx.select().from(branches))[0]);
    const r = await withActor(lamsaAdmin, (tx) =>
      addMember(tx, lamsaAdmin, {
        nameAr: "د. تجربة",
        nameEn: "Dr. Test",
        email: `dr.test.${stamp}@lamsa.demo`,
        roles: ["practitioner"],
        branchId: branch.id,
      }),
    );
    expect(r.needsPassword).toBe(true);
    const hours = await withTenant(LAMSA, (tx) =>
      tx.select().from(staffSchedules).where(eq(staffSchedules.memberId, r.memberId)),
    );
    expect(hours).toHaveLength(5);
    expect(
      (await withTenant(LAMSA, (tx) => branchPractitioners(tx, branch.id))).map((m) => m.id),
    ).toContain(r.memberId);

    // The invitation: they set their own password once.
    expect((await withTenant(LAMSA, (tx) => inviteInfo(tx, r.userId)))?.passwordSet).toBe(false);
    await withTenant(LAMSA, (tx) => setInvitedPassword(tx, r.userId, "a-long-password-1"));
    expect(
      await code(withTenant(LAMSA, (tx) => setInvitedPassword(tx, r.userId, "x".repeat(12)))),
    ).toBe("password_already_set");
    expect(await canSignInToClinic(LAMSA, `dr.test.${stamp}@lamsa.demo`)).toBe(true);

    // The same email can't be added twice.
    expect(
      await code(
        withActor(lamsaAdmin, (tx) =>
          addMember(tx, lamsaAdmin, {
            nameAr: "د. تجربة",
            email: `dr.test.${stamp}@lamsa.demo`,
            roles: ["practitioner"],
            branchId: null,
          }),
        ),
      ),
    ).toBe("already_member");

    // Deactivated: no sign-in, no access, not bookable. Reactivated: back.
    await withActor(lamsaAdmin, (tx) => setActive(tx, lamsaAdmin, r.memberId, false));
    expect(await canSignInToClinic(LAMSA, `dr.test.${stamp}@lamsa.demo`)).toBe(false);
    expect(await getStaffAccess(LAMSA, { id: r.userId })).toBeNull();
    expect(
      (await withTenant(LAMSA, (tx) => branchPractitioners(tx, branch.id))).map((m) => m.id),
    ).not.toContain(r.memberId);
    await withActor(lamsaAdmin, (tx) => setActive(tx, lamsaAdmin, r.memberId, true));
    expect(await getStaffAccess(LAMSA, { id: r.userId })).not.toBeNull();
    await withActor(lamsaAdmin, (tx) => setActive(tx, lamsaAdmin, r.memberId, false));
  });

  it("the clinic keeps an admin; nobody deactivates themselves", async () => {
    expect(await code(withActor(admin, (tx) => setActive(tx, admin, admin.memberId!, false)))).toBe(
      "self",
    );
  });

  it("links a doctor to one website profile; the website's Book then books them", async () => {
    const sara = member("derma-dr-sara");
    const site = async () =>
      (await withTenant(DERMA, (tx) => tx.select().from(tenantSettings)))[0].site as SiteContent;
    await withActor(admin, (tx) => linkWebsiteDoctor(tx, admin, sara, 3));
    expect((await site()).doctors?.[3].memberId).toBe(sara);
    await withActor(admin, (tx) => linkWebsiteDoctor(tx, admin, sara, 4));
    const after = await site();
    expect(after.doctors?.[3].memberId).toBeUndefined();
    expect(after.doctors?.[4].memberId).toBe(sara);
    await withActor(admin, (tx) => linkWebsiteDoctor(tx, admin, sara, null));
    expect((await site()).doctors?.some((d) => d.memberId)).toBe(false);
    // Reception is not a doctor: no website link.
    expect(
      await code(
        withActor(admin, (tx) => linkWebsiteDoctor(tx, admin, member("derma-rec-ruh1"), 2)),
      ),
    ).toBe("not_found");
  });
});
