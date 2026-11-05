/**
 * Tapping a notification must never lead to a "no permission" page, for any type and any role
 * (doctor, reception, admin, and people with several roles). A patient concern opens the patient's
 * file for doctors (with the concern and the post-care chat) and the WhatsApp inbox for reception.
 * Also: the doctor's open concerns (My Day) and when a concern counts as answered.
 */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { conversations, messages, patients, pushSubscriptions, tenantMembers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { ROLES, type Role } from "@/lib/auth/permissions";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import { canOpen, PAGE_PERMISSIONS, pageOf, pushLink, type LinkContext } from "@/lib/push/links";
import { planPushes } from "@/lib/push/notify";
import { ALL_PUSH_TYPES } from "@/lib/push/payload";
import { saveSubscription } from "@/lib/push/subscriptions";
import { concernThread, findConcerns } from "@/lib/whatsapp/concerns";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendPostCare } from "@/lib/whatsapp/outbox";
import { markHandled } from "@/lib/whatsapp/staff";
import { resolveConcern } from "@/lib/whatsapp/concern-actions";
import {
  admin,
  DERMA,
  drFaisal,
  drSara,
  member,
  patient,
  reception,
  riyadhAt,
  RIYADH,
  service,
} from "./fixtures";

afterAll(closeDb);

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const derma = { id: DERMA, slug: "derma", isDemo: true };
const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const CLINIC_ROLES = ROLES.filter((r) => r !== "platform_owner");
/** Every combination of clinic roles a member can hold (at least one). */
const COMBOS: Role[][] = [1, 2, 3, 4, 5, 6, 7].map((mask) =>
  CLINIC_ROLES.filter((_, i) => mask & (1 << i)),
);
const CTX: LinkContext = {
  appointmentId: "11111111-1111-1111-1111-111111111111",
  patientId: "22222222-2222-2222-2222-222222222222",
  day: "2032-01-11",
  conversationId: "33333333-3333-3333-3333-333333333333",
};

describe("the link table matches the pages", () => {
  it.each(Object.entries(PAGE_PERMISSIONS))("%s asks for %s", (path, permission) => {
    const file = `src/app/(app)${path}/page.tsx`;
    const source = readFileSync(file, "utf8");
    expect(source.match(/requirePermission\("([^"]+)"\)/)?.[1]).toBe(permission);
  });

  it("links are recognised (query strings and ids ignored)", () => {
    expect(pageOf("/patients/abc?concern=x#concern")).toBe("/patients/[id]");
    expect(pageOf("/my-day?date=2032-01-11")).toBe("/my-day");
    expect(pageOf("/settings")).toBeNull();
  });
});

describe("every push type, every role: never a no-permission page", () => {
  for (const type of ALL_PUSH_TYPES) {
    it.each(COMBOS.map((c) => [c.join("+"), c] as const))(`${type} → %s`, (_, roles) => {
      const url = pushLink(type, roles, CTX);
      expect(canOpen(roles, url), url).toBe(true);
    });
  }

  it("a concern: doctors → the patient's file; reception and admin → the inbox thread", () => {
    const concern = (roles: Role[]) => pushLink("patient_concern", roles, CTX);
    const file = `/patients/${CTX.patientId}?concern=${CTX.appointmentId}#concern`;
    const inbox = `/whatsapp?f=needs_reply&c=${CTX.conversationId}`;
    expect(concern(["practitioner"])).toBe(file);
    expect(concern(["clinic_admin", "practitioner"])).toBe(file);
    expect(concern(["receptionist"])).toBe(inbox);
    expect(concern(["clinic_admin"])).toBe(inbox);
    expect(pushLink("patient_concern", ["receptionist"], { ...CTX, conversationId: null })).toBe(
      "/whatsapp?f=needs_reply",
    );
  });

  it("doctor events open My Day on that date; reception events the calendar on that date", () => {
    expect(pushLink("checked_in", ["practitioner"], CTX)).toBe("/my-day?date=2032-01-11");
    expect(pushLink("checked_in", ["receptionist"], CTX)).toBe("/calendar?date=2032-01-11");
    expect(pushLink("online_booking", ["receptionist"], CTX)).toBe("/calendar?date=2032-01-11");
    expect(pushLink("reschedule_request", ["receptionist"], CTX)).toBe("/requests");
    expect(pushLink("reschedule_request", ["practitioner"], CTX)).toBe("/my-day?date=2032-01-11");
  });
});

let slot = 0;
const DAYS = ["2032-01-11", "2032-01-12", "2032-01-13", "2032-01-14", "2032-01-18"];
const book = (
  file: string,
  doctor = "derma-dr-sara",
  code = "facial_treatment", // has a post-care check-in
): Promise<Appointment> =>
  withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member(doctor),
      startsAt: riyadhAt("10:00", DAYS[slot++ % DAYS.length]),
    }),
  );

/** "I have a concern" exactly as the simulator taps it (post-care message, then the button). */
async function raiseConcern(a: Appointment, file: string) {
  expect((await sendPostCare(derma, a.id, ENV)).outcome).toBe("sent");
  const [postCare] = await system((tx) =>
    tx
      .select()
      .from(messages)
      .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "post_care"))),
  );
  const [p] = await system((tx) =>
    tx
      .select()
      .from(patients)
      .where(eq(patients.id, patient(file))),
  );
  await handleInbound(
    derma,
    [
      {
        type: "message",
        eventId: `sim-concern-${a.id}`,
        from: p.phone,
        kind: "button",
        buttonPayload: postCare.buttons![1].id,
        buttonTitle: "لدي استفسار/قلق",
      },
    ],
    { env: ENV, notify: async () => {} },
  );
  const [convo] = await system((tx) =>
    tx.select().from(conversations).where(eq(conversations.phone, p.phone)),
  );
  return convo;
}

describe("the links actually sent, per recipient", () => {
  it("every planned notification opens a page its recipient may see", async () => {
    // A device for the doctor and both Riyadh receptionists.
    for (const u of ["usr_derma-dr-sara", "usr_derma-rec-ruh1", "usr_derma-rec-ruh2"]) {
      await system((tx) =>
        saveSubscription(tx, {
          tenantId: DERMA,
          userId: u,
          sub: {
            endpoint: `https://push.example.test/links-${u}`,
            p256dh:
              "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
            auth: "tBHItJI5svbpez7KI4CCXg",
          },
        }),
      );
    }
    const a = await book("D-0011"); // D-0011 has a WhatsApp chat (demo data)
    const members = await system((tx) => tx.select().from(tenantMembers));
    const rolesOf = (userId: string) => members.find((m) => m.userId === userId)!.roles as Role[];
    const { planned } = await system((tx) =>
      planPushes(
        tx,
        ALL_PUSH_TYPES.map((type) => ({ type, appointmentId: a.id })),
      ),
    );
    expect(new Set(planned.map((p) => p.type)).size).toBe(ALL_PUSH_TYPES.length);
    for (const p of planned) {
      expect(canOpen(rolesOf(p.userId), p.payload.url), `${p.type} → ${p.userId}`).toBe(true);
    }
    const [convo] = await system((tx) =>
      tx
        .select()
        .from(conversations)
        .where(eq(conversations.patientId, patient("D-0011"))),
    );
    const concernTo = (u: string) =>
      planned.find((p) => p.type === "patient_concern" && p.userId === u)!.payload.url;
    expect(concernTo("usr_derma-dr-sara")).toBe(
      `/patients/${patient("D-0011")}?concern=${a.id}#concern`,
    );
    expect(concernTo("usr_derma-rec-ruh1")).toBe(`/whatsapp?f=needs_reply&c=${convo.id}`);
    await system((tx) =>
      tx.delete(pushSubscriptions).where(like(pushSubscriptions.endpoint, "%/links-%")),
    );
  });
});

describe("concerns for the doctor (My Day) and the patient's file", () => {
  it("open for the visit's doctor only, with the post-care chat; closed when marked resolved", async () => {
    const a = await book("D-0012");
    const convo = await raiseConcern(a, "D-0012");

    const sara = await withActor(drSara, (tx) =>
      findConcerns(tx, { practitionerId: member("derma-dr-sara"), openOnly: true }),
    );
    const mine = sara.find((c) => c.appointmentId === a.id);
    expect(mine).toMatchObject({ open: true, patientId: patient("D-0012"), fileNumber: "D-0012" });
    const faisal = await withActor(drFaisal, (tx) =>
      findConcerns(tx, { practitionerId: member("derma-dr-faisal"), openOnly: true }),
    );
    expect(faisal.some((c) => c.appointmentId === a.id)).toBe(false);

    // The doctor can read the conversation: post-care question, the concern, the clinic's reply.
    const thread = await withActor(drSara, (tx) => concernThread(tx, mine!));
    const kinds = thread.map((m) => m.kind);
    expect(kinds[0]).toBe("post_care");
    expect(kinds).toContain("inbound_button");
    expect(kinds).toContain("concern_ack");
    expect(thread.find((m) => m.flag === "concern")).toBeTruthy();

    // Reception marks the CHAT handled: the concern stays open for the doctor…
    await withActor(reception, (tx) => markHandled(tx, reception, convo.id));
    const stillOpen = await withActor(drSara, (tx) =>
      findConcerns(tx, { practitionerId: member("derma-dr-sara"), openOnly: true }),
    );
    expect(stillOpen.some((c) => c.appointmentId === a.id)).toBe(true);
    // …until someone marks the CONCERN resolved (still shown when asked for directly).
    await withActor(reception, (tx) => resolveConcern(tx, reception, a.id, null));
    const after = await withActor(drSara, (tx) =>
      findConcerns(tx, { practitionerId: member("derma-dr-sara"), openOnly: true }),
    );
    expect(after.some((c) => c.appointmentId === a.id)).toBe(false);
    const onFile = await withActor(drSara, (tx) =>
      findConcerns(tx, { patientId: patient("D-0012"), appointmentId: a.id }),
    );
    expect(onFile).toMatchObject([{ appointmentId: a.id, open: false }]);
  });

  it("an admin without the practitioner role sees the concern on the file too (no notes needed)", async () => {
    const a = await book("D-0013");
    await raiseConcern(a, "D-0013");
    const list = await withActor(admin, (tx) => findConcerns(tx, { patientId: patient("D-0013") }));
    expect(list.some((c) => c.appointmentId === a.id && c.open)).toBe(true);
  });
});
