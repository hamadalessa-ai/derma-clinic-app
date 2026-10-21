/** Daily cleanup (Vercel Cron): protected by CRON_SECRET, removes only old security rows. */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/daily/route";
import { closeDb } from "@/db/client";
import { verificationCodes } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { dailyCleanup } from "@/lib/maintenance/cleanup";
import { DERMA } from "./fixtures";

afterAll(closeDb);

const call = (auth?: string) =>
  GET(
    new NextRequest("http://derma.localhost:3000/api/cron/daily", {
      headers: auth ? { authorization: auth } : {},
    }),
  );

describe("cron route", () => {
  it("refuses without the secret, with a wrong one, and when no secret is configured", async () => {
    const before = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "a-test-cron-secret-123456";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("a-test-cron-secret-123456")).status).toBe(401);
    expect((await call("Bearer a-test-cron-secret-123456")).status).toBe(200);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    if (before) process.env.CRON_SECRET = before;
  });
});

describe("cleanup", () => {
  it("removes codes expired over a day ago, keeps recent ones", async () => {
    const phone = "0597000111";
    await withTenant(DERMA, (tx) =>
      tx.insert(verificationCodes).values([
        {
          tenantId: DERMA,
          phone,
          purpose: "portal",
          codeHash: "old",
          expiresAt: sql`now() - interval '3 days'`,
        },
        {
          tenantId: DERMA,
          phone,
          purpose: "portal",
          codeHash: "fresh",
          expiresAt: sql`now() + interval '5 minutes'`,
        },
      ]),
    );
    const r = await dailyCleanup();
    expect(r.derma.codes).toBeGreaterThanOrEqual(1);
    const left = await withTenant(DERMA, (tx) =>
      tx.select().from(verificationCodes).where(eq(verificationCodes.phone, phone)),
    );
    expect(left.map((c) => c.codeHash)).toEqual(["fresh"]);
  });
});
