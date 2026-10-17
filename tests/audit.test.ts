import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { auditLogs, patients } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { audit, auditEvent } from "@/lib/audit";

const A = demoId("tenant:derma");
const B = demoId("tenant:lamsa");

afterAll(closeDb);

describe("audit()", () => {
  it("records who did what to which record, and when", async () => {
    const before = new Date(Date.now() - 1000);
    const row = await auditEvent(A, {
      actorUserId: "usr_derma-admin",
      action: "patient.view",
      entityType: "patient",
      entityId: demoId("derma:patient:D-0001"),
      metadata: { reason: "test" },
    });
    expect(row.tenantId).toBe(A);
    expect(row.actorUserId).toBe("usr_derma-admin");
    expect(row.action).toBe("patient.view");
    expect(row.entityType).toBe("patient");
    expect(row.metadata).toEqual({ reason: "test" });
    expect(row.createdAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("is saved together with the change, or not at all", async () => {
    const id = demoId("derma:patient:D-0002");
    await expect(
      withTenant(A, async (tx) => {
        await tx.update(patients).set({ fullNameEn: "Changed" }).where(eq(patients.id, id));
        await audit(tx, {
          actorUserId: "u",
          action: "patient.update",
          entityType: "patient",
          entityId: id,
        });
        throw new Error("fail after audit");
      }),
    ).rejects.toThrow();
    const logs = await withTenant(A, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "patient.update"), eq(auditLogs.entityId, id))),
    );
    expect(logs).toHaveLength(0);
  });

  it("is always stamped with the transaction's clinic, and invisible to other clinics", async () => {
    const row = await auditEvent(B, {
      actorUserId: null,
      action: "test.event",
      entityType: "test",
    });
    expect(row.tenantId).toBe(B);
    const seenByA = await withTenant(A, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.id, row.id)),
    );
    expect(seenByA).toHaveLength(0);
  });
});
