/**
 * Staff login hardening: cross-clinic sign-in limits (stored hashed), password rules for invited
 * staff, and who must use two-step verification.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { getAuth } from "@/lib/auth/auth";
import { twoFactorRequired } from "@/lib/auth/session";
import { bucketOf, globalHits, takeGlobalLimit } from "@/lib/security/global-limit";
import { passwordProblem } from "@/lib/security/password";

afterAll(closeDb);

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("limits across all clinics", () => {
  it("allows up to the limit, then refuses; other keys are not affected", async () => {
    const key = `login:email:limit-${stamp}@clinic.test`;
    const lim = [{ key, limit: 3, windowMinutes: 15 }];
    expect(await takeGlobalLimit(lim)).toBe(true);
    expect(await takeGlobalLimit(lim)).toBe(true);
    expect(await takeGlobalLimit(lim)).toBe(true);
    expect(await takeGlobalLimit(lim)).toBe(false);
    expect(await globalHits(key, 15)).toBe(3);
    expect(await takeGlobalLimit([{ key: `${key}-other`, limit: 3, windowMinutes: 15 }])).toBe(true);
  });

  it("refuses when ANY of the limits is full (email OR network address)", async () => {
    const ip = `login:ip:10.0.0.${stamp}`;
    expect(await takeGlobalLimit([{ key: ip, limit: 1, windowMinutes: 15 }])).toBe(true);
    expect(
      await takeGlobalLimit([
        { key: `login:email:fresh-${stamp}@clinic.test`, limit: 10, windowMinutes: 15 },
        { key: ip, limit: 1, windowMinutes: 15 },
      ]),
    ).toBe(false);
  });

  it("stores only hashes, never the email or address itself", async () => {
    const key = `login:email:hashed-${stamp}@clinic.test`;
    await takeGlobalLimit([{ key, limit: 5, windowMinutes: 15 }]);
    const rows = await getDb().execute<{ bucket: string }>(
      sql`select bucket from global_rate_hits where bucket = ${bucketOf(key)}`,
    );
    expect(rows).toHaveLength(1);
    const plain = await getDb().execute(
      sql`select 1 from global_rate_hits where bucket like ${"%" + stamp + "%"}`,
    );
    expect(plain).toHaveLength(0);
  });
});

describe("staff passwords", () => {
  it("refuses well-known passwords and the person's own name or email", async () => {
    expect(await passwordProblem("1234567890", [])).toBe("too_common");
    expect(await passwordProblem("aaaaaaaaaaaa", [])).toBe("too_common");
    expect(await passwordProblem("Nawal-2026-x!", ["nawal@derma.demo", "Nawal Al-Qahtani"])).toBe(
      "contains_name",
    );
    expect(await passwordProblem("green-tea-moon-41", ["nawal@derma.demo"])).toBeNull();
  });
});

describe("two-step verification", () => {
  it("is required for admins, doctors and the platform owner of real clinics only", () => {
    const real = { isDemo: false };
    const demo = { isDemo: true };
    const staff = { isPlatformOwner: false };
    expect(twoFactorRequired(real, staff, ["clinic_admin"])).toBe(true);
    expect(twoFactorRequired(real, staff, ["practitioner"])).toBe(true);
    expect(twoFactorRequired(real, staff, ["receptionist"])).toBe(false);
    expect(twoFactorRequired(real, { isPlatformOwner: true }, ["platform_owner"])).toBe(true);
    expect(twoFactorRequired(demo, staff, ["clinic_admin", "practitioner"])).toBe(false);
  });

  it("is wired into the login library", () => {
    const api = getAuth().api as Record<string, unknown>;
    for (const fn of ["enableTwoFactor", "verifyTOTP", "verifyBackupCode", "disableTwoFactor"]) {
      expect(typeof api[fn]).toBe("function");
    }
  });
});
