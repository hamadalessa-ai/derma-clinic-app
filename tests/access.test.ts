import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { demoId } from "@/db/seed-data";
import { canSignInToClinic, getStaffAccess } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";

const DERMA = demoId("tenant:derma");
const LAMSA = demoId("tenant:lamsa");

afterAll(closeDb);

describe("who may enter which clinic", () => {
  it("Derma staff can sign in to Derma but not to Lamsa", async () => {
    expect(await canSignInToClinic(DERMA, "reception.riyadh1@derma.demo")).toBe(true);
    expect(await canSignInToClinic(LAMSA, "reception.riyadh1@derma.demo")).toBe(false);
    expect(await canSignInToClinic(DERMA, "admin@lamsa.demo")).toBe(false);
  });

  it("unknown emails cannot sign in anywhere", async () => {
    expect(await canSignInToClinic(DERMA, "nobody@example.com")).toBe(false);
  });

  it("emails are matched case-insensitively", async () => {
    expect(await canSignInToClinic(DERMA, "  Admin@Derma.Demo ")).toBe(true);
  });

  it("a Lamsa member gets no access to Derma even with a valid session", async () => {
    expect(await getStaffAccess(DERMA, { id: "usr_lamsa-admin" })).toBeNull();
  });
});

describe("roles and branches inside Derma Clinics", () => {
  it.each([
    ["usr_derma-admin", "clinic_admin", 2],
    ["usr_derma-dr-sara", "practitioner", 1],
    ["usr_derma-rec-ruh1", "receptionist", 1],
    ["usr_derma-dr-lina", "practitioner", 1],
  ] as const)("%s is %s and sees %i branch(es)", async (userId, role, branchCount) => {
    const access = await getStaffAccess(DERMA, { id: userId });
    expect(access?.role).toBe(role);
    expect(access?.branches).toHaveLength(branchCount);
  });

  it("a Jeddah doctor only gets the Jeddah branch", async () => {
    const access = await getStaffAccess(DERMA, { id: "usr_derma-dr-lina" });
    expect(access?.branches.map((b) => b.nameEn)).toEqual(["Jeddah Branch"]);
  });

  it("the receptionist is blocked from clinical notes; the doctor is not", async () => {
    const rec = await getStaffAccess(DERMA, { id: "usr_derma-rec-ruh1" });
    const doc = await getStaffAccess(DERMA, { id: "usr_derma-dr-sara" });
    expect(can(rec?.role, "clinical_notes:read")).toBe(false);
    expect(can(doc?.role, "clinical_notes:read")).toBe(true);
  });

  it("the platform owner enters as platform_owner, with no patient access", async () => {
    expect(await canSignInToClinic(DERMA, "owner@platform.demo")).toBe(true);
    const access = await getStaffAccess(DERMA, { id: "usr_platform-owner", isPlatformOwner: true });
    expect(access?.role).toBe("platform_owner");
    expect(can(access?.role, "patients:read")).toBe(false);
  });
});
