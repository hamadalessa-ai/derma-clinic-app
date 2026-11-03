/**
 * Doctors handle post-care concerns from the Concern card: reply on WhatsApp (signed with their
 * name, 24-hour window), ask for a photo (stored in the file via the FileStore), internal note,
 * follow-up (booked directly or sent to reception, by the clinic setting), resolve.
 * Role rules, branch walls, patient walls and the audit log are checked here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import {
  appointments,
  auditLogs,
  concernEvents,
  conversations,
  files,
  messages,
  patients,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor, type Actor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError, type Appointment } from "@/lib/booking/engine";
import { patientDbContext } from "@/lib/portal/session";
import type { PushEvent } from "@/lib/push/notify";
import { updateSettings } from "@/lib/settings";
import {
  addConcernNote,
  askForPhoto,
  bookFollowUpRequest,
  ConcernError,
  followUpConcern,
  openFollowUpRequests,
  replyToConcern,
  resolveConcern,
} from "@/lib/whatsapp/concern-actions";
import { findConcerns } from "@/lib/whatsapp/concerns";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendPostCare } from "@/lib/whatsapp/outbox";
import { messageView } from "@/lib/whatsapp/view";
import {
  admin,
  DERMA,
  drFaisal,
  drLina,
  drSara,
  member,
  patient,
  reception,
  receptionJeddah,
  riyadhAt,
  RIYADH,
  service,
} from "./fixtures";

afterAll(closeDb);

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const derma = { id: DERMA, slug: "derma", isDemo: true };
const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const FILE = "D-0038";
let visit: Appointment;
let convoId: string;
let phone: string;
const pushes: PushEvent[] = [];
const notify = async (e: PushEvent[]) => void pushes.push(...e);

/** Days used by no other test (June 2034). */
let slot = 0;
const DAYS = ["2034-06-04", "2034-06-05", "2034-06-06", "2034-06-07", "2034-06-11"];
const book = (actor: Actor, file: string, code = "facial_treatment") =>
  withActor(actor, (tx) =>
    bookAppointment(tx, actor, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt("10:00", DAYS[slot++ % DAYS.length]),
    }),
  );
const lastMessage = async (kind: string) => {
  const [m] = await system((tx) =>
    tx
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, convoId), eq(messages.kind, kind)))
      .orderBy(desc(messages.createdAt))
      .limit(1),
  );
  return m;
};
const audits = (action: string) =>
  system((tx) =>
    tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, visit.id))),
  );
/** Moves the patient's last message back in time (to test WhatsApp's 24-hour window). */
const lastInboundHoursAgo = (h: number) =>
  system((tx) =>
    tx
      .update(conversations)
      .set({ lastInboundAt: new Date(Date.now() - h * 3600_000) })
      .where(eq(conversations.id, convoId)),
  );

beforeAll(async () => {
  visit = await book(reception, FILE);
  expect((await sendPostCare(derma, visit.id, ENV)).outcome).toBe("sent");
  const [postCare] = await system((tx) =>
    tx
      .select()
      .from(messages)
      .where(and(eq(messages.appointmentId, visit.id), eq(messages.kind, "post_care"))),
  );
  const [p] = await system((tx) =>
    tx
      .select()
      .from(patients)
      .where(eq(patients.id, patient(FILE))),
  );
  phone = p.phone;
  convoId = postCare.conversationId;
  await handleInbound(
    derma,
    [
      {
        type: "message",
        eventId: `sim-concern-${visit.id}`,
        from: phone,
        kind: "button",
        buttonPayload: postCare.buttons![1].id,
        buttonTitle: "لدي استفسار/قلق",
      },
    ],
    { env: ENV, notify },
  );
});

describe("the doctor replies from the Concern card", () => {
  it("goes through the WhatsApp sender, signed with the doctor's name, and is audited", async () => {
    const r = await replyToConcern(
      derma,
      drSara,
      visit.id,
      "الاحمرار طبيعي، ضعي كمادات باردة.",
      ENV,
    );
    expect(r.outcome).toBe("sent");
    const m = await lastMessage("staff_reply");
    expect(m).toMatchObject({
      direction: "out",
      sentBy: "usr_derma-dr-sara",
      appointmentId: visit.id,
    });
    expect(m.body).toMatch(/كمادات باردة\.\n— د\. سارة العتيبي$/);
    expect(await audits("concern.reply")).toHaveLength(1);
    // Staff screens show who replied; the patient sees the clinic (and the signature in the text).
    const names = new Map([["usr_derma-dr-sara", "د. سارة العتيبي"]]);
    expect(messageView(m, "ar", { names }).sentByName).toBe("د. سارة العتيبي");
  });

  it("reception and admins may reply too; other roles may not", async () => {
    await expect(
      replyToConcern(derma, reception, visit.id, "سنتصل بك.", ENV),
    ).resolves.toMatchObject({
      outcome: "sent",
    });
    await expect(
      replyToConcern(derma, { ...admin, roles: ["platform_owner"] }, visit.id, "x", ENV),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("branch walls: Jeddah staff can't see (or reply to) a Riyadh concern", async () => {
    for (const a of [drLina, receptionJeddah]) {
      await expect(replyToConcern(derma, a, visit.id, "x", ENV)).rejects.toMatchObject({
        code: "not_found",
      });
    }
  });

  it("24-hour window: no free reply or photo request after it; works again inside it", async () => {
    await lastInboundHoursAgo(25);
    await expect(replyToConcern(derma, drSara, visit.id, "x", ENV)).rejects.toMatchObject({
      code: "outside_window",
    });
    await expect(askForPhoto(derma, drSara, visit.id, ENV)).rejects.toMatchObject({
      code: "outside_window",
    });
    await lastInboundHoursAgo(23);
    await expect(askForPhoto(derma, drSara, visit.id, ENV)).resolves.toMatchObject({
      outcome: "sent",
    });
    const m = await lastMessage("photo_request");
    expect(m.body).toContain("د. سارة العتيبي");
    expect(await audits("concern.photo_request")).toHaveLength(1);
  });

  it("an empty reply is refused", async () => {
    await expect(replyToConcern(derma, drSara, visit.id, "   ", ENV)).rejects.toBeInstanceOf(
      ConcernError,
    );
  });
});

describe("the patient's photo", () => {
  it("is stored in the patient's file (FileStore), tied to the concern; the doctor is notified", async () => {
    const jpeg = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 120, b: 110 } },
    })
      .jpeg()
      .toBuffer();
    pushes.length = 0;
    await handleInbound(
      derma,
      [
        {
          type: "message",
          eventId: `sim-photo-${visit.id}`,
          from: phone,
          kind: "image",
          text: "هذه صورة المنطقة",
          media: { mimeType: "image/jpeg", dataBase64: jpeg.toString("base64") },
        },
      ],
      { env: ENV, notify },
    );
    const m = await lastMessage("inbound_image");
    expect(m).toMatchObject({ direction: "in", appointmentId: visit.id, body: "هذه صورة المنطقة" });
    expect(m.fileId).toBeTruthy();
    const [f] = await system((tx) => tx.select().from(files).where(eq(files.id, m.fileId!)));
    expect(f).toMatchObject({ kind: "patient_photo", mimeType: "image/jpeg" });
    expect(pushes).toContainEqual({ type: "concern_photo", appointmentId: visit.id });
    // Doctors and admins see it; reception gets "photo received" instead.
    expect(messageView(m, "ar", { canSeePhotos: true }).photo).toEqual({
      url: `/api/files/${m.fileId}`,
    });
    expect(messageView(m, "ar", { canSeePhotos: false }).photo).toBe("hidden");
  });
});

describe("notes, follow-up and resolving", () => {
  it("an internal note: never sent to the patient, flags the chat for reception, notifies", async () => {
    const before = await system((tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, convoId)),
    );
    const push = await withActor(drSara, (tx) =>
      addConcernNote(tx, drSara, visit.id, "نرجو الاتصال بالمريضة اليوم."),
    );
    expect(push).toEqual([
      { type: "concern_note", appointmentId: visit.id, actorUserId: "usr_derma-dr-sara" },
    ]);
    const after = await system((tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, convoId)),
    );
    expect(after.length).toBe(before.length); // nothing went to WhatsApp
    const notes = await withActor(reception, (tx) =>
      tx.select().from(concernEvents).where(eq(concernEvents.appointmentId, visit.id)),
    );
    expect(notes.find((n) => n.kind === "note")).toMatchObject({
      body: "نرجو الاتصال بالمريضة اليوم.",
      actorUserId: "usr_derma-dr-sara",
    });
    const [c] = await system((tx) =>
      tx.select().from(conversations).where(eq(conversations.id, convoId)),
    );
    expect(c.needsReply).toBe(true);
    expect(await audits("concern.note")).toHaveLength(1);
  });

  it("follow-up, 'doctors manage their own schedule' OFF: a ready request that reception books", async () => {
    const startsAt = riyadhAt("12:00", "2034-06-12");
    const r = await withActor(drSara, (tx) =>
      followUpConcern(tx, drSara, visit.id, { serviceId: service("consultation"), startsAt }),
    );
    expect(r.mode).toBe("request");
    const open = await withActor(reception, (tx) => openFollowUpRequests(tx));
    const req = open.find((x) => x.appointmentId === visit.id)!;
    expect(req).toMatchObject({
      practitionerId: member("derma-dr-sara"),
      proposedStartsAt: startsAt,
    });
    // Doctors can't book it themselves; reception can.
    await expect(
      withActor(drSara, (tx) => bookFollowUpRequest(tx, drSara, req.id)),
    ).rejects.toBeInstanceOf(PermissionError);
    const booked = await withActor(reception, (tx) => bookFollowUpRequest(tx, reception, req.id));
    expect(booked.mode).toBe("book");
    const [a] = await system((tx) =>
      tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, (booked as { appointmentId: string }).appointmentId)),
    );
    expect(a).toMatchObject({
      patientId: patient(FILE),
      practitionerId: member("derma-dr-sara"),
      startsAt,
    });
    const still = await withActor(reception, (tx) => openFollowUpRequests(tx));
    expect(still.some((x) => x.id === req.id)).toBe(false);
    expect(await audits("concern.follow_up_requested")).toHaveLength(1);
  });

  it("follow-up, setting ON: the visit's doctor books it directly (same booking engine); another doctor sends a request", async () => {
    await withActor(admin, (tx) => updateSettings(tx, admin, { doctorsManageOwnSchedule: true }));
    try {
      const startsAt = riyadhAt("13:00", "2034-06-13");
      const r = await withActor(drSara, (tx) =>
        followUpConcern(tx, drSara, visit.id, { serviceId: service("consultation"), startsAt }),
      );
      expect(r.mode).toBe("book");
      const [a] = await system((tx) =>
        tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, (r as { appointmentId: string }).appointmentId)),
      );
      expect(a).toMatchObject({ practitionerId: member("derma-dr-sara"), status: "booked" });
      // The engine still refuses a taken time (no double-booking).
      await expect(
        withActor(drSara, (tx) =>
          followUpConcern(tx, drSara, visit.id, { serviceId: service("consultation"), startsAt }),
        ),
      ).rejects.toBeInstanceOf(BookingError);
      // Not her visit: Dr. Faisal can't book for Dr. Sara → request to reception.
      const other = await withActor(drFaisal, (tx) =>
        followUpConcern(tx, drFaisal, visit.id, {
          serviceId: service("consultation"),
          startsAt: riyadhAt("15:00", "2034-06-13"),
        }),
      );
      expect(other.mode).toBe("request");
      // Reception's booking of the earlier request + Dr. Sara's own booking.
      expect(await audits("concern.follow_up_booked")).toHaveLength(2);
    } finally {
      await withActor(admin, (tx) =>
        updateSettings(tx, admin, { doctorsManageOwnSchedule: false }),
      );
    }
  });

  it("mark resolved (with a note): leaves My Day, stays on the file; audited", async () => {
    const open = () =>
      withActor(drSara, (tx) =>
        findConcerns(tx, { practitionerId: member("derma-dr-sara"), openOnly: true }),
      );
    expect((await open()).some((c) => c.appointmentId === visit.id)).toBe(true);
    await withActor(drSara, (tx) => resolveConcern(tx, drSara, visit.id, "تحسنت الحالة."));
    expect((await open()).some((c) => c.appointmentId === visit.id)).toBe(false);
    const onFile = await withActor(drSara, (tx) => findConcerns(tx, { appointmentId: visit.id }));
    expect(onFile).toMatchObject([{ open: false }]);
    expect(await audits("concern.resolved")).toHaveLength(1);
  });
});

describe("patient walls", () => {
  it("a signed-in patient never sees notes, follow-ups, chats or photos", async () => {
    const seen = await withTenant(patientDbContext(DERMA, patient(FILE)), async (tx) => ({
      events: await tx.select().from(concernEvents),
      messages: await tx.select().from(messages),
      photos: await tx
        .select()
        .from(files)
        .where(inArray(files.kind, ["patient_photo"])),
    }));
    expect(seen).toEqual({ events: [], messages: [], photos: [] });
  });

  it("patients can't write concern records either", async () => {
    await expect(
      withTenant(patientDbContext(DERMA, patient(FILE)), (tx) =>
        tx.insert(concernEvents).values({
          tenantId: DERMA,
          appointmentId: visit.id,
          conversationId: convoId,
          patientId: patient(FILE),
          kind: "resolved",
          actorUserId: "x",
        }),
      ),
    ).rejects.toThrow();
  });
});
