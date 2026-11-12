/**
 * Verification codes, rate limits and DEMO safety.
 * Codes: 6 digits, 10 minutes, 5 tries, only the newest works, only a hash is stored.
 * Demo: the code is shown on screen ONLY for a demo clinic AND MESSAGE_DEMO_MODE=on.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { closeDb } from "@/db/client";
import { conversations, messages, verificationCodes } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { demoId } from "@/db/seed-data";
import { demoMessagingAllowed, getMessageSender, redacted } from "@/lib/messaging/sender";
import { maskPhone, normalizeSaudiMobile } from "@/lib/phone";
import { checkCode, CODE_RULES, sendCode, VerifyError } from "@/lib/verify/codes";

const DERMA = demoId("tenant:derma");
const LAMSA = demoId("tenant:lamsa");
const DEMO_ON = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const DEMO_OFF = { ...process.env, MESSAGE_DEMO_MODE: undefined };
const demoClinic = { id: DERMA, isDemo: true };
const realClinic = { id: DERMA, isDemo: false };

let phoneSeq = 0;
/** A fresh fake phone per test, so rate limits from one test don't affect another. */
const freshPhone = () =>
  `0599${String(process.pid % 1000).padStart(3, "0")}${String(++phoneSeq).padStart(3, "0")}`;

let admin: postgres.Sql;
beforeAll(() => {
  // Local superuser on the test database: only it may back-date rate-limit rows (RLS is forced
  // even for the table owner, and the app role may not change them at all).
  const url = new URL(
    process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres",
  );
  url.pathname = new URL(inject("appUrl")).pathname;
  admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await admin.end();
  await closeDb();
});

const send = (phone: string, opts: Partial<Parameters<typeof sendCode>[1]> = {}) =>
  withTenant(DERMA, (tx) =>
    sendCode(tx, { tenant: demoClinic, phone, purpose: "portal", ip: null, env: DEMO_ON, ...opts }),
  );
const check = (phone: string, code: string) =>
  withTenant(DERMA, (tx) =>
    checkCode(tx, { tenantId: DERMA, phone, purpose: "portal", code, env: DEMO_ON }),
  );
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof VerifyError ? e.code : String(e)),
  );

describe("phone numbers", () => {
  it.each([
    ["0501234567", "0501234567"],
    ["501234567", "0501234567"],
    ["+966 50 123 4567", "0501234567"],
    ["00966501234567", "0501234567"],
    ["٠٥٠١٢٣٤٥٦٧", "0501234567"],
    ["050-123-4567", "0501234567"],
  ])("%s → %s", (input, out) => expect(normalizeSaudiMobile(input)).toBe(out));

  it.each(["", "12345", "0401234567", "05012345678", "abc0501234567", "+1 202 555 0100"])(
    "rejects %s",
    (input) => expect(normalizeSaudiMobile(input)).toBeNull(),
  );

  it("masks numbers for logs", () => expect(maskPhone("0501234567")).toBe("05•••••567"));
});

describe("DEMO safety", () => {
  it("demo mode needs BOTH a demo clinic and MESSAGE_DEMO_MODE=on", () => {
    expect(demoMessagingAllowed({ isDemo: true }, { MESSAGE_DEMO_MODE: "on" })).toBe(true);
    expect(demoMessagingAllowed({ isDemo: true }, {})).toBe(false);
    expect(demoMessagingAllowed({ isDemo: true }, { MESSAGE_DEMO_MODE: "true" })).toBe(false);
    expect(demoMessagingAllowed({ isDemo: false }, { MESSAGE_DEMO_MODE: "on" })).toBe(false);
  });

  it("a demo clinic with the flag on gets the code back to show on screen", async () => {
    const { demoCode } = await send(freshPhone());
    expect(demoCode).toMatch(/^\d{6}$/);
  });

  it("a NON-demo clinic never shows the code, even with the flag on — it fails safely", async () => {
    const phone = freshPhone();
    expect(getMessageSender({ id: DERMA, isDemo: false }, { MESSAGE_DEMO_MODE: "on" })).toBeNull();
    expect(await errorOf(send(phone, { tenant: realClinic }))).toBe("messaging_unavailable");
    // …and no code was created.
    const rows = await withTenant(DERMA, (tx) =>
      tx.select().from(verificationCodes).where(eq(verificationCodes.phone, phone)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a demo clinic WITHOUT the flag also fails safely (no real sender configured)", async () => {
    expect(await errorOf(send(freshPhone(), { env: DEMO_OFF }))).toBe("messaging_unavailable");
  });

  it("demo: the code shows in the simulator; the code table only stores a hash", async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone);
    // Demo clinic + demo mode: the code is shown in the WhatsApp simulator (that's the point).
    const [msg] = await withTenant(DERMA, (tx) =>
      tx
        .select({ m: messages })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(eq(conversations.phone, phone)),
    );
    expect(msg.m.channel).toBe("demo");
    expect(msg.m.kind).toBe("verification_code");
    expect(msg.m.body).toContain(demoCode!);
    const [row] = await withTenant(DERMA, (tx) =>
      tx.select().from(verificationCodes).where(eq(verificationCodes.phone, phone)),
    );
    expect(row.codeHash).not.toContain(demoCode!);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redacts every secret placeholder", () => {
    expect(
      redacted({
        to: "x",
        template: "t",
        body: "a {code} b {code} {name}",
        secrets: { code: "1" },
      }),
    ).toBe("a ****** b ****** {name}");
  });
});

describe("checking a code", () => {
  it("the right code works once", async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone);
    expect(await check(phone, demoCode!)).toEqual({ ok: true });
    expect(await check(phone, demoCode!)).toEqual({ ok: false, error: "code_expired" });
  });

  it("a wrong code is refused", async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone);
    const wrong = demoCode === "000000" ? "111111" : "000000";
    expect(await check(phone, wrong)).toEqual({ ok: false, error: "wrong_code" });
    expect(await check(phone, "abc")).toEqual({ ok: false, error: "wrong_code" });
    expect(await check(phone, demoCode!)).toEqual({ ok: true });
  });

  it(`after ${CODE_RULES.maxAttempts} tries the code is dead, even the right one`, async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone);
    const wrong = demoCode === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < CODE_RULES.maxAttempts; i++) results.push((await check(phone, wrong)).ok);
    expect(results.every((ok) => !ok)).toBe(true);
    expect(await check(phone, demoCode!)).toEqual({ ok: false, error: "too_many_attempts" });
  });

  it("an expired code is refused", async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone);
    await withTenant(DERMA, (tx) =>
      tx
        .update(verificationCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(verificationCodes.phone, phone)),
    );
    expect(await check(phone, demoCode!)).toEqual({ ok: false, error: "code_expired" });
  });

  it("codes expire after 10 minutes", async () => {
    const phone = freshPhone();
    await send(phone);
    const [row] = await withTenant(DERMA, (tx) =>
      tx.select().from(verificationCodes).where(eq(verificationCodes.phone, phone)),
    );
    const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(CODE_RULES.ttlMinutes, 1);
  });

  it("asking for a new code cancels the old one", async () => {
    const phone = freshPhone();
    const first = await send(phone);
    const second = await send(phone);
    if (first.demoCode !== second.demoCode) {
      expect(await check(phone, first.demoCode!)).toEqual({ ok: false, error: "wrong_code" });
    }
    expect(await check(phone, second.demoCode!)).toEqual({ ok: true });
  });

  it("a code is only valid for its purpose and phone", async () => {
    const phone = freshPhone();
    const { demoCode } = await send(phone, { purpose: "booking" });
    expect(await check(phone, demoCode!)).toEqual({ ok: false, error: "code_expired" });
    expect(await check(freshPhone(), demoCode!)).toEqual({ ok: false, error: "code_expired" });
  });

  it("a code from another clinic does not work here", async () => {
    const phone = freshPhone();
    const LAMSA = demoId("tenant:lamsa");
    const { demoCode } = await withTenant(LAMSA, (tx) =>
      sendCode(tx, {
        tenant: { id: LAMSA, isDemo: true },
        phone,
        purpose: "portal",
        ip: null,
        env: DEMO_ON,
      }),
    );
    expect(await check(phone, demoCode!)).toEqual({ ok: false, error: "code_expired" });
  });
});

describe("rate limits", () => {
  it(`at most ${CODE_RULES.perPhone15Min} codes per phone per 15 minutes`, async () => {
    const phone = freshPhone();
    for (let i = 0; i < CODE_RULES.perPhone15Min; i++) await send(phone);
    expect(await errorOf(send(phone))).toBe("rate_limited");
    // Another phone is not affected.
    expect(await errorOf(send(freshPhone()))).toBe("ok");
  });

  it(`at most ${CODE_RULES.perPhoneDay} codes per phone per day`, async () => {
    const phone = freshPhone();
    // Pretend earlier codes were sent an hour ago (outside the 15-minute window, inside the day).
    for (let i = 0; i < CODE_RULES.perPhoneDay; i++) {
      await send(phone);
      // (The app itself can't change rate-limit rows; the test uses the admin connection.)
      await admin`update rate_limit_hits set created_at = now() - interval '1 hour'
                  where bucket = ${`otp:phone:${phone}`}`;
    }
    expect(await errorOf(send(phone))).toBe("rate_limited");
  });

  it(`at most ${CODE_RULES.perIpHour} codes per IP per hour (across phones)`, async () => {
    const ip = `203.0.113.${(process.pid % 200) + 1}`;
    for (let i = 0; i < CODE_RULES.perIpHour; i++) {
      expect(await errorOf(send(freshPhone(), { ip }))).toBe("ok");
    }
    expect(await errorOf(send(freshPhone(), { ip }))).toBe("rate_limited");
  });

  it("parallel requests cannot squeeze past the limit", async () => {
    const phone = freshPhone();
    const results = await Promise.all(Array.from({ length: 8 }, () => errorOf(send(phone))));
    expect(results.filter((r) => r === "ok")).toHaveLength(CODE_RULES.perPhone15Min);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(8 - CODE_RULES.perPhone15Min);
  });

  it("a refused request leaves no code behind", async () => {
    const phone = freshPhone();
    for (let i = 0; i < CODE_RULES.perPhone15Min; i++) await send(phone);
    await errorOf(send(phone));
    const rows = await withTenant(DERMA, (tx) =>
      tx.select().from(verificationCodes).where(eq(verificationCodes.phone, phone)),
    );
    expect(rows).toHaveLength(CODE_RULES.perPhone15Min);
  });
});
