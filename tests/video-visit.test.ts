/**
 * Video consultations: booked in the branch's video room (only the doctor's time is reserved),
 * joined through a signed link (patient) or My Day (the appointment's own doctor), only around
 * the appointment time, after the telehealth consent. Uses a fake video provider (no network).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import { appointments, auditLogs, reservations, rooms } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor, type Actor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError } from "@/lib/booking/engine";
import { currentTemplate, saveConsentRule, signConsent } from "@/lib/consents/consents";
import { parseVideoToken, videoJoinUrl, videoRoomName, videoToken } from "@/lib/video/link";
import type { VideoProvider } from "@/lib/video/provider";
import { doctorJoin, patientJoin, videoState, VideoVisitError } from "@/lib/video/visit";
import { appointmentVars, loadAppointmentContext } from "@/lib/whatsapp/compose";
import { loadBookingCatalog } from "@/lib/online/catalog";
import {
  admin,
  DERMA,
  drFaisal,
  drReem,
  drSara,
  LAMSA,
  member,
  patient,
  reception,
  JEDDAH,
  RIYADH,
  riyadhAt,
  room,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-02-10"; // a Sunday no other test uses
const at = (time: string) => riyadhAt(time, DAY);

let signature: Buffer;
beforeAll(async () => {
  signature = await sharp({
    create: { width: 400, height: 150, channels: 4, background: "#ffffff" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="150"><path d="M20 100 C 120 10, 200 140, 380 40" stroke="black" stroke-width="4" fill="none"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  // Sign per visit in these tests (the clinic default is "valid 12 months").
  await withActor(admin, (tx) =>
    saveConsentRule(tx, admin, { code: "telehealth", rule: "every_visit", months: null }),
  );
});

function fakeProvider() {
  const calls: { kind: string; input: Record<string, unknown> }[] = [];
  const provider: VideoProvider = {
    async ensureRoom(input) {
      calls.push({ kind: "room", input });
      return `https://demo.daily.co/${input.name}`;
    },
    async joinToken(input) {
      calls.push({ kind: "token", input });
      return `tok-${input.owner ? "host" : "guest"}`;
    },
  };
  return { provider, calls };
}

async function book(file: string, time: string, doctor: string, code = "video_consultation") {
  return withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member(doctor),
      startsAt: at(time),
    }),
  );
}

async function errCode(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof VideoVisitError || e instanceof BookingError) return e.code;
    if (e instanceof PermissionError) return "permission";
    throw e;
  }
  return "ok";
}

async function signTelehealth(file: string, appointmentId: string, actor: Actor = reception) {
  await withActor(actor, async (tx) => {
    const tpl = await currentTemplate(tx, "telehealth");
    return signConsent(tx, actor, {
      patientId: patient(file),
      templateId: tpl!.id,
      signerName: "توقيع تجريبي",
      signerRelation: "self",
      signaturePng: signature,
      appointmentId,
    });
  });
}

describe("booking a video consultation", () => {
  it("uses the branch's video room, which is never reserved (only the doctors are)", async () => {
    // Three video visits at the same time, with three doctors: no room is "taken".
    const a = await book("D-0021", "10:00", "derma-dr-sara");
    const b = await book("D-0022", "10:00", "derma-dr-faisal");
    const c = await book("D-0023", "10:00", "derma-dr-reem");
    for (const x of [a, b, c]) expect(x.roomId).toBe(room("ruh-video"));
    const held = await withActor(reception, (tx) =>
      tx
        .select({ kind: reservations.resourceKind })
        .from(reservations)
        .where(eq(reservations.appointmentId, a.id)),
    );
    expect(held.map((r) => r.kind)).toEqual(["practitioner"]);

    // The doctor is still reserved: no second booking for Dr. Sara at 10:00.
    expect(await errCode(book("D-0024", "10:00", "derma-dr-sara"))).toBe("slot_taken");
  });

  it("an in-clinic service never gets the video room", async () => {
    const x = await book("D-0024", "16:00", "derma-dr-sara", "consultation");
    const [r] = await withActor(reception, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, x.roomId)),
    );
    expect(r.isVirtual).toBe(false);
  });
});

describe("join links", () => {
  it("are signed for one clinic and one appointment", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const token = videoToken(DERMA, id);
    expect(parseVideoToken(DERMA, token)).toBe(id);
    expect(parseVideoToken(LAMSA, token)).toBeNull();
    const other = "11111111-2222-4333-8444-555555555556";
    expect(parseVideoToken(DERMA, `${other}.${token.split(".")[1]}`)).toBeNull();
    expect(parseVideoToken(DERMA, "nonsense")).toBeNull();
    expect(videoJoinUrl("https://x.example", DERMA, id)).toBe(`https://x.example/visit/${token}`);
    // The room's name is a code: no appointment id, no patient details.
    expect(videoRoomName(DERMA, id)).toMatch(/^vc-[0-9a-f]{24}$/);
    expect(videoRoomName(DERMA, id)).not.toContain(id.slice(0, 8));
  });

  it("are in the WhatsApp confirmation and reminder (instead of the map)", async () => {
    const a = await book("D-0025", "11:00", "derma-dr-sara");
    const ctx = await withTenant(DERMA, (tx) => loadAppointmentContext(tx, a.id));
    const ar = appointmentVars(ctx!, "ar", "https://clinic.example");
    const link = `https://clinic.example/visit/${videoToken(DERMA, a.id)}`;
    expect(ar.map_link).toBe(link);
    expect(ar.instructions).toContain(link);
    const en = appointmentVars(ctx!, "en", "https://clinic.example");
    expect(en.instructions).toContain("video consultation");
  });
});

describe("the join window", () => {
  const v = {
    isVirtual: true,
    status: "booked",
    startsAt: at("12:00"),
    endsAt: at("12:20"),
  };
  it("opens 15 minutes before for patients, 30 for the doctor, closes 30 after the end", () => {
    expect(videoState(v, "patient", at("11:44"))).toBe("too_early");
    expect(videoState(v, "patient", at("11:45"))).toBe("open");
    expect(videoState(v, "doctor", at("11:30"))).toBe("open");
    expect(videoState(v, "patient", at("12:49"))).toBe("open");
    expect(videoState(v, "patient", at("12:50"))).toBe("ended");
    expect(videoState({ ...v, status: "cancelled" }, "patient", at("12:00"))).toBe("cancelled");
    expect(videoState({ ...v, status: "completed" }, "patient", at("12:00"))).toBe("ended");
    expect(videoState({ ...v, isVirtual: false }, "patient", at("12:00"))).toBe("not_virtual");
  });
});

describe("joining", () => {
  it("patient: needs the right time and the consent, then gets a personal link", async () => {
    const a = await book("D-0026", "12:00", "derma-dr-sara");
    const token = videoToken(DERMA, a.id);
    const fake = fakeProvider();
    const join = (now: Date, provider: VideoProvider | null = fake.provider) =>
      patientJoin(DERMA, token, { provider, now });

    expect(await errCode(join(at("11:00")))).toBe("too_early");
    expect(await errCode(join(at("12:05")))).toBe("consent");
    await signTelehealth("D-0026", a.id);
    expect(await errCode(join(at("12:05"), null))).toBe("not_configured");
    expect(fake.calls).toHaveLength(0); // nothing reached the video service yet

    const r = await join(at("12:05"));
    expect(r.url).toBe(`https://demo.daily.co/${videoRoomName(DERMA, a.id)}?t=tok-guest`);
    // Joining = arrived (no check-in at reception needed); joining again changes nothing.
    const status = async () =>
      (
        await withActor(reception, (tx) =>
          tx.select({ s: appointments.status }).from(appointments).where(eq(appointments.id, a.id)),
        )
      )[0].s;
    expect(await status()).toBe("arrived");
    await join(at("12:06"));
    expect(await status()).toBe("arrived");
    const room = fake.calls.find((c) => c.kind === "room")!.input;
    expect(room.name).toBe(videoRoomName(DERMA, a.id));
    // Open from the doctor's early window until 30 minutes after the planned end.
    expect(room.opensAt).toEqual(at("11:30"));
    expect(room.closesAt).toEqual(at("12:50"));
    const tok = fake.calls.find((c) => c.kind === "token")!.input;
    expect(tok.owner).toBe(false);
    expect(String(tok.userName)).not.toMatch(/\s/); // first name only

    expect(await errCode(patientJoin(DERMA, "x".repeat(59), { provider: fake.provider }))).toBe(
      "not_found",
    );
    const [log] = await withTenant(DERMA, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "video.patient_joined"), eq(auditLogs.entityId, a.id))),
    );
    expect(log).toBeDefined();
  });

  it("doctor: only the appointment's own doctor, as the host", async () => {
    const a = await book("D-0027", "13:00", "derma-dr-faisal");
    const fake = fakeProvider();
    const now = at("12:40");
    expect(await errCode(doctorJoin(drSara, a.id, { provider: fake.provider, now }))).toBe(
      "not_yours",
    );
    expect(await errCode(doctorJoin(reception, a.id, { provider: fake.provider, now }))).toBe(
      "permission",
    );
    expect(
      await errCode(doctorJoin(drFaisal, a.id, { provider: fake.provider, now: at("12:00") })),
    ).toBe("too_early");
    const r = await doctorJoin(drFaisal, a.id, { provider: fake.provider, now });
    expect(r.url).toContain("?t=tok-host");
    expect(fake.calls.find((c) => c.kind === "token")!.input.owner).toBe(true);
  });

  it("an in-clinic appointment has no video", async () => {
    const a = await book("D-0028", "17:00", "derma-dr-reem", "consultation");
    const fake = fakeProvider();
    expect(
      await errCode(doctorJoin(drReem, a.id, { provider: fake.provider, now: at("17:00") })),
    ).toBe("not_virtual");
    expect(
      await errCode(
        patientJoin(DERMA, videoToken(DERMA, a.id), { provider: fake.provider, now: at("17:00") }),
      ),
    ).toBe("not_virtual");
  });
});

describe("the booking page", () => {
  it("knows which branches offer video and which services are video (patients choose first)", async () => {
    const c = await withTenant(DERMA, (tx) => loadBookingCatalog(tx));
    expect([...c.videoBranches].sort()).toEqual([RIYADH, JEDDAH].sort());
    const all = c.departments.flatMap((d) => d.services);
    expect(all.filter((s) => s.isVirtual).map((s) => s.nameEn)).toEqual(["Video Consultation"]);
    // Listed first for reception and the AI receptionist.
    expect(all[0].nameEn).toBe("Video Consultation");
    const lamsa = await withTenant(LAMSA, (tx) => loadBookingCatalog(tx));
    expect(lamsa.videoBranches).toEqual([]);
  });
});
