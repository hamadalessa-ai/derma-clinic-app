/**
 * Stuck messages are marked failed (never resent) and flagged for staff; ops alerts reach the
 * webhook without patient data, never flood, and never break the work that raised them.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, conversations, messages } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { opsAlert, resetOpsAlerts } from "@/lib/ops/alert";
import { ensureConversation } from "@/lib/whatsapp/store";
import { STUCK_ERROR, sweepStuckMessages } from "@/lib/whatsapp/stuck";
import { DERMA } from "./fixtures";

afterAll(closeDb);
beforeEach(() => resetOpsAlerts());

describe("stuck messages", () => {
  it("old 'queued' messages become failed with a reason; the chat is flagged; new ones are left", async () => {
    const phone = "0590009911";
    const { oldId, newId, convoId } = await withTenant(DERMA, async (tx) => {
      const convo = await ensureConversation(tx, { phone, profileName: "Stuck Test" });
      await tx
        .update(conversations)
        .set({ needsReply: false })
        .where(eq(conversations.id, convo.id));
      const base = {
        tenantId: DERMA,
        conversationId: convo.id,
        direction: "out",
        kind: "reminder",
        body: "reminder",
        channel: "demo",
        status: "queued",
      };
      const [old] = await tx
        .insert(messages)
        .values({ ...base, createdAt: new Date(Date.now() - 20 * 60_000) })
        .returning({ id: messages.id });
      const [fresh] = await tx.insert(messages).values(base).returning({ id: messages.id });
      return { oldId: old!.id, newId: fresh!.id, convoId: convo.id };
    });

    expect(await sweepStuckMessages(DERMA)).toBeGreaterThanOrEqual(1);
    const rows = await withTenant(DERMA, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, convoId)),
    );
    expect(rows.find((m) => m.id === oldId)).toMatchObject({
      status: "failed",
      errorCode: STUCK_ERROR,
    });
    expect(rows.find((m) => m.id === newId)).toMatchObject({ status: "queued" });
    const [c] = await withTenant(DERMA, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, convoId)),
    );
    expect(c!.needsReply).toBe(true);
    const logged = await withTenant(DERMA, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "whatsapp.stuck"))),
    );
    expect(logged.length).toBeGreaterThan(0);
    // Running again finds nothing new (and never resends).
    expect(await sweepStuckMessages(DERMA)).toBe(0);
  });
});

describe("ops alerts", () => {
  it("posts a short text to the webhook, once per 10 minutes for the same event", async () => {
    const realFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response("ok");
    }) as typeof fetch;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = { OPS_ALERT_WEBHOOK_URL: "https://hooks.example.test/x" };
      await opsAlert("scheduled_messages_failed", { clinic: "derma", error: "TimeoutError" }, env);
      await opsAlert("scheduled_messages_failed", { clinic: "derma", error: "TimeoutError" }, env);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]!).text).toContain("scheduled_messages_failed");
      expect(JSON.parse(sent[0]!).text).toContain("clinic: derma");
      expect(log).toHaveBeenCalledTimes(1);
      // Another clinic is a different alert.
      await opsAlert("scheduled_messages_failed", { clinic: "lamsa" }, env);
      expect(sent).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
      log.mockRestore();
    }
  });

  it("never throws when the webhook can't be reached, and works without one", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        opsAlert("server_error", { route: "/x" }, { OPS_ALERT_WEBHOOK_URL: "https://h.test" }),
      ).resolves.toBeUndefined();
      await expect(opsAlert("server_error", { route: "/y" }, {})).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = realFetch;
      log.mockRestore();
    }
  });
});
