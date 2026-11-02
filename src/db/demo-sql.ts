/**
 * SQL for the Phase 1 demo data (all FAKE): the demo week of appointments, blocked time,
 * patient packages with payments and used sessions, signed consents and clinical notes.
 * Dates are relative to pg_temp.setup_params.demo_anchor (the day setup.sql is run).
 */
import { createHash } from "node:crypto";
import { contentFingerprint } from "../lib/consents/fingerprint";
import { DEMO_SIGNATURE_PNG_BASE64, DEMO_TIME_BLOCKS, generateDemoWeek } from "./demo-week";
import { CONSENT_TEMPLATES, DERMA, demoId, LAMSA, PACKAGE_TEMPLATES } from "./seed-data";
import { DEMO_PUSH_HOST } from "../lib/push/payload";
import { insert, raw } from "./sql-render";
import { BUTTON_TITLES, fill, REPLIES, SERVICE_TEXTS, TEMPLATES } from "../lib/whatsapp/catalog";

const ANCHOR = "(select demo_anchor from pg_temp.setup_params)";
const at = (dayIndex: number, time: string, plusMinutes = 0) =>
  raw(
    `((public.demo_workday(${ANCHOR}, ${dayIndex}) + time '${time}') at time zone 'Asia/Riyadh')` +
      (plusMinutes ? ` + interval '${plusMinutes} minutes'` : ""),
  );
const daysAgo = (n: number) => raw(`now() - interval '${n} days'`);
const hoursAgo = (n: number) => raw(`now() - interval '${n} hours'`);

interface DemoPackage {
  key: string;
  patientFile: string;
  templateKey: string;
  used: number;
  paidSar: number[];
  boughtDaysAgo: number;
}

/** Packages the demo story uses. D-0002: laser 3/6 used, consent NOT signed (check-in demo). */
export const DEMO_PACKAGES: DemoPackage[] = [
  {
    key: "d0002-lhr",
    patientFile: "D-0002",
    templateKey: "lhr6",
    used: 3,
    paidSar: [1800],
    boughtDaysAgo: 75,
  },
  {
    key: "d0011-lhr",
    patientFile: "D-0011",
    templateKey: "lhr6",
    used: 3,
    paidSar: [3600],
    boughtDaysAgo: 90,
  },
  {
    key: "d0015-peel",
    patientFile: "D-0015",
    templateKey: "peel4",
    used: 1,
    paidSar: [500, 500],
    boughtDaysAgo: 30,
  },
  {
    key: "d0018-boost",
    patientFile: "D-0018",
    templateKey: "boost3",
    used: 0,
    paidSar: [3900],
    boughtDaysAgo: 5,
  },
  {
    key: "d0004-facial",
    patientFile: "D-0004",
    templateKey: "facial5",
    used: 2,
    paidSar: [],
    boughtDaysAgo: 40,
  },
];

const signerOf = (file: string) => DERMA.patients.find((p) => p.fileNumber === file)!.fullNameAr;

export const DEMO_CONSENTS = [
  {
    key: "d0011-lhr",
    patientFile: "D-0011",
    code: "laser_hair_removal",
    signer: signerOf("D-0011"),
    daysAgo: 90,
  },
  {
    key: "d0015-peel",
    patientFile: "D-0015",
    code: "chemical_peel",
    signer: signerOf("D-0015"),
    daysAgo: 30,
  },
  {
    key: "d0004-inj",
    patientFile: "D-0004",
    code: "injectables",
    signer: signerOf("D-0004"),
    daysAgo: 40,
  },
];

const SARA = { id: "usr_derma-dr-sara", name: "د. سارة العتيبي" };

export function demoSql(): string {
  const tenant = demoId("tenant:derma");
  const ref = (kind: string, key: string) => demoId(`derma:${kind}:${key}`);
  const out: string[] = [];

  // Blocked time first, so the generated week is placed around it.
  out.push(
    insert(
      "time_blocks",
      DEMO_TIME_BLOCKS.map((b) => ({
        id: ref("time_block", b.key),
        tenant_id: tenant,
        branch_id: ref("branch", b.branchKey),
        member_id: ref("member", b.doctorKey),
        starts_at: at(b.dayIndex, b.start),
        ends_at: at(b.dayIndex, b.end),
        reason: b.reason,
        demo_day_index: b.dayIndex,
        created_by: "usr_derma-admin",
      })),
    ),
  );

  // Appointments (the reservation triggers check there is no overlap).
  const week = generateDemoWeek();
  out.push(
    insert(
      "appointments",
      week.map((a) => ({
        id: ref("appointment", a.key),
        tenant_id: tenant,
        branch_id: ref("branch", a.branchKey),
        patient_id: ref("patient", a.patientFile),
        service_id: ref("service", a.serviceCode),
        practitioner_id: ref("member", a.doctorKey),
        room_id: ref("room", a.roomKey),
        device_id: a.deviceKey ? ref("device", a.deviceKey) : null,
        starts_at: at(a.dayIndex, a.time),
        ends_at: at(a.dayIndex, a.time, a.durationMinutes),
        blocked_until: at(a.dayIndex, a.time, a.durationMinutes + a.bufferMinutes),
        status: a.status,
        reception_note: a.note ?? null,
        cancel_reason: a.status === "cancelled" ? "طلب المريض" : null,
        demo_day_index: a.dayIndex,
        source: a.source ?? "reception",
        created_by: a.source === "online" ? null : "usr_derma-rec-ruh1",
      })),
    ),
  );

  // A pending reschedule request from Dr. Sara (setting OFF at Derma → reception decides).
  const saraLater = week.find(
    (a) => a.doctorKey === "derma-dr-sara" && a.dayIndex === 2 && a.status !== "cancelled",
  );
  if (saraLater) {
    out.push(
      insert("reschedule_requests", [
        {
          tenant_id: tenant,
          branch_id: ref("branch", "riyadh"),
          appointment_id: ref("appointment", saraLater.key),
          requested_by: SARA.id,
          proposed_starts_at: at(3, "18:30"),
          reason: "لدي محاضرة في المؤتمر صباحًا",
          status: "pending",
        },
      ]),
    );
  }

  // Packages: sold some time ago, sessions used recorded as events (the balance trigger applies them).
  const templates = new Map(PACKAGE_TEMPLATES.derma.map((t) => [t.key, t]));
  out.push(
    insert(
      "patient_packages",
      DEMO_PACKAGES.map((p) => {
        const t = templates.get(p.templateKey)!;
        return {
          id: ref("patient_package", p.key),
          tenant_id: tenant,
          patient_id: ref("patient", p.patientFile),
          template_id: ref("package_template", t.key),
          service_id: ref("service", t.serviceCode),
          name_ar: t.nameAr,
          name_en: t.nameEn,
          sessions_total: t.sessions,
          price_halalas: t.priceSar * 100,
          purchased_at: daysAgo(p.boughtDaysAgo),
          expires_at: raw(
            `now() - interval '${p.boughtDaysAgo} days' + interval '${t.validityDays} days'`,
          ),
          sold_by: "usr_derma-rec-ruh1",
        };
      }),
    ),
  );
  out.push(
    insert(
      "package_payments",
      DEMO_PACKAGES.flatMap((p) =>
        p.paidSar.map((sar, i) => ({
          tenant_id: tenant,
          patient_package_id: ref("patient_package", p.key),
          amount_halalas: sar * 100,
          method: i % 2 === 0 ? "card" : "cash",
          paid_at: daysAgo(p.boughtDaysAgo - i * 14),
          recorded_by: "usr_derma-rec-ruh1",
        })),
      ),
    ),
  );
  out.push(
    insert(
      "package_session_events",
      DEMO_PACKAGES.flatMap((p) =>
        Array.from({ length: p.used }, (_, i) => ({
          tenant_id: tenant,
          patient_package_id: ref("patient_package", p.key),
          kind: "override",
          delta: 1,
          reason: `جلسة سابقة ${i + 1} (بيانات تجريبية)`,
          created_by: "usr_derma-rec-ruh1",
          created_at: daysAgo(p.boughtDaysAgo - (i + 1) * 21),
        })),
      ),
    ),
  );

  // Signed consents: a signature file + the official record with a snapshot of version 1.
  const png = Buffer.from(DEMO_SIGNATURE_PNG_BASE64, "base64");
  const pngSha = createHash("sha256").update(png).digest("hex");
  out.push(
    insert(
      "files",
      DEMO_CONSENTS.map((c) => ({
        id: ref("file", `sig-${c.key}`),
        tenant_id: tenant,
        kind: "signature",
        mime_type: "image/png",
        size_bytes: png.length,
        sha256: pngSha,
        data: raw(`decode('${DEMO_SIGNATURE_PNG_BASE64}', 'base64')`),
        created_by: "usr_derma-rec-ruh1",
      })),
    ),
  );
  const tpl = new Map(CONSENT_TEMPLATES.map((t) => [t.code, t]));
  out.push(
    insert(
      "patient_consents",
      DEMO_CONSENTS.map((c) => {
        const t = tpl.get(c.code)!;
        return {
          id: ref("patient_consent", c.key),
          tenant_id: tenant,
          patient_id: ref("patient", c.patientFile),
          template_id: ref("consent_template", `${c.code}:v1`),
          template_code: c.code,
          template_version: 1,
          title_ar: t.titleAr,
          title_en: t.titleEn,
          body_ar: t.bodyAr,
          body_en: t.bodyEn,
          content_sha256: contentFingerprint(t),
          signer_name: c.signer,
          signer_relation: "self",
          signature_file_id: ref("file", `sig-${c.key}`),
          witness_user_id: "usr_derma-rec-ruh1",
          signed_at: daysAgo(c.daysAgo),
        };
      }),
    ),
  );

  // Clinical notes by Dr. Sara: two signed (one with an addendum) and one draft.
  out.push(
    insert("clinical_notes", [
      {
        id: ref("note", "d0001-signed"),
        tenant_id: tenant,
        patient_id: ref("patient", "D-0001"),
        author_user_id: SARA.id,
        author_name: SARA.name,
        body: "الشكوى: خطوط تعبيرية بين الحاجبين.\nالفحص: بشرة سليمة، لا علامات التهاب.\nالخطة: بوتوكس 20 وحدة مع مراجعة بعد 14 يومًا. تنبيه: حساسية من الليدوكايين — تم استخدام تخدير بديل.",
        status: "signed",
        signed_at: daysAgo(21),
        created_at: daysAgo(21),
      },
      {
        id: ref("note", "d0011-signed"),
        tenant_id: tenant,
        patient_id: ref("patient", "D-0011"),
        author_user_id: SARA.id,
        author_name: SARA.name,
        body: "جلسة ليزر إزالة الشعر رقم 3 من 6. المنطقة: الساقين. الإعدادات: 18 J/cm² — 10 ms. لا مضاعفات.",
        status: "signed",
        signed_at: daysAgo(12),
        created_at: daysAgo(12),
      },
      {
        id: ref("note", "d0005-draft"),
        tenant_id: tenant,
        patient_id: ref("patient", "D-0005"),
        author_user_id: SARA.id,
        author_name: SARA.name,
        body: "مسودة: استشارة بخصوص التصبغات. يقترح تقشير كيميائي خفيف — بانتظار نتائج اختبار الحساسية.",
        status: "draft",
        signed_at: null,
        created_at: daysAgo(1),
      },
    ]),
  );
  out.push(
    insert("clinical_note_addenda", [
      {
        tenant_id: tenant,
        note_id: ref("note", "d0001-signed"),
        author_user_id: SARA.id,
        author_name: SARA.name,
        body: "إضافة: المراجعة تمت — نتيجة متماثلة، لا حاجة لجرعة إضافية.",
        created_at: daysAgo(7),
      },
    ]),
  );

  // Lamsa: a little Phase 1 data too, so isolation tests cover every new table.
  const lamsa = demoId("tenant:lamsa");
  const lref = (kind: string, key: string) => demoId(`lamsa:${kind}:${key}`);
  const lt = PACKAGE_TEMPLATES.lamsa[0];
  out.push(
    insert("appointments", [
      {
        id: lref("appointment", "today-1"),
        tenant_id: lamsa,
        branch_id: lref("branch", "dammam"),
        patient_id: lref("patient", "L-0002"),
        service_id: lref("service", "facial_treatment"),
        practitioner_id: lref("member", "lamsa-dr-mona"),
        room_id: lref("room", "dmm-1"),
        device_id: null,
        starts_at: at(0, "11:00"),
        ends_at: at(0, "11:00", 60),
        blocked_until: at(0, "11:00", 75),
        status: "confirmed",
        reception_note: null,
        cancel_reason: null,
        demo_day_index: 0,
        created_by: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("time_blocks", [
      {
        id: lref("time_block", "mona-break"),
        tenant_id: lamsa,
        branch_id: lref("branch", "dammam"),
        member_id: lref("member", "lamsa-dr-mona"),
        starts_at: at(0, "16:00"),
        ends_at: at(0, "17:00"),
        reason: "اجتماع",
        demo_day_index: 0,
        created_by: "usr_lamsa-admin",
      },
    ]),
  );
  out.push(
    insert("patient_packages", [
      {
        id: lref("patient_package", "l0002-facial"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        template_id: lref("package_template", lt.key),
        service_id: lref("service", lt.serviceCode),
        name_ar: lt.nameAr,
        name_en: lt.nameEn,
        sessions_total: lt.sessions,
        price_halalas: lt.priceSar * 100,
        purchased_at: daysAgo(20),
        expires_at: raw(`now() + interval '160 days'`),
        sold_by: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("package_payments", [
      {
        tenant_id: lamsa,
        patient_package_id: lref("patient_package", "l0002-facial"),
        amount_halalas: 90000,
        method: "card",
        paid_at: daysAgo(20),
        recorded_by: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("package_session_events", [
      {
        tenant_id: lamsa,
        patient_package_id: lref("patient_package", "l0002-facial"),
        kind: "override",
        delta: 1,
        reason: "جلسة سابقة (بيانات تجريبية)",
        created_by: "usr_lamsa-rec",
        created_at: daysAgo(10),
      },
    ]),
  );
  out.push(
    insert("files", [
      {
        id: lref("file", "sig-l0002"),
        tenant_id: lamsa,
        kind: "signature",
        mime_type: "image/png",
        size_bytes: png.length,
        sha256: pngSha,
        data: raw(`decode('${DEMO_SIGNATURE_PNG_BASE64}', 'base64')`),
        created_by: "usr_lamsa-rec",
      },
    ]),
  );
  const inj = tpl.get("injectables")!;
  out.push(
    insert("patient_consents", [
      {
        id: lref("patient_consent", "l0002-inj"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        template_id: lref("consent_template", "injectables:v1"),
        template_code: "injectables",
        template_version: 1,
        title_ar: inj.titleAr,
        title_en: inj.titleEn,
        body_ar: inj.bodyAr,
        body_en: inj.bodyEn,
        content_sha256: contentFingerprint(inj),
        signer_name: "مريضة لمسة",
        signer_relation: "self",
        signature_file_id: lref("file", "sig-l0002"),
        witness_user_id: "usr_lamsa-rec",
        signed_at: daysAgo(20),
      },
    ]),
  );
  out.push(
    insert("clinical_notes", [
      {
        id: lref("note", "l0002"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        author_user_id: "usr_lamsa-dr-mona",
        author_name: "د. منى السبيعي",
        body: "ملاحظة لمسة السرية.",
        status: "signed",
        signed_at: daysAgo(10),
        created_at: daysAgo(10),
      },
    ]),
  );
  out.push(
    insert("clinical_note_addenda", [
      {
        tenant_id: lamsa,
        note_id: lref("note", "l0002"),
        author_user_id: "usr_lamsa-dr-mona",
        author_name: "د. منى السبيعي",
        body: "إضافة لمسة.",
        created_at: daysAgo(9),
      },
    ]),
  );
  out.push(
    insert("reschedule_requests", [
      {
        tenant_id: lamsa,
        branch_id: lref("branch", "dammam"),
        appointment_id: lref("appointment", "today-1"),
        requested_by: "usr_lamsa-dr-mona",
        proposed_starts_at: at(1, "12:00"),
        reason: "طلب تجريبي",
        status: "pending",
      },
    ]),
  );
  out.push(phase2aRows());
  out.push(phase2bRows(week));
  return out.filter(Boolean).join("\n");
}

/**
 * Phase 2a rows in BOTH clinics (old, used-up codes and sessions, a logged demo message,
 * notification choices and a demo push device), so the isolation tests cover every new table.
 */
function phase2aRows(): string {
  const out: string[] = [];
  for (const [slug, patientFile, adminKey] of [
    ["derma", "D-0007", "derma-admin"],
    ["lamsa", "L-0002", "lamsa-admin"],
  ] as const) {
    const tenant = demoId(`tenant:${slug}`);
    const patient = demoId(`${slug}:patient:${patientFile}`);
    const phone = (slug === "derma" ? DERMA : LAMSA).patients.find(
      (p) => p.fileNumber === patientFile,
    )!.phone;
    out.push(
      insert("verification_codes", [
        {
          tenant_id: tenant,
          phone,
          purpose: "portal",
          // Not a real code: a fixed placeholder hash, long expired and used.
          code_hash: createHash("sha256").update(`demo-used-code:${slug}`).digest("hex"),
          expires_at: hoursAgo(12),
          attempts: 1,
          consumed_at: hoursAgo(12),
          created_at: hoursAgo(12),
        },
      ]),
      insert("rate_limit_hits", [
        { tenant_id: tenant, bucket: `otp:phone:${phone}`, created_at: hoursAgo(12) },
      ]),
      insert("patient_sessions", [
        {
          tenant_id: tenant,
          patient_id: patient,
          token_hash: createHash("sha256").update(`demo-old-session:${slug}`).digest("hex"),
          expires_at: hoursAgo(12),
          revoked_at: hoursAgo(12),
          created_at: hoursAgo(12),
        },
      ]),
      insert("conversations", [
        {
          id: demoId(`${slug}:conversation:${patientFile}`),
          tenant_id: tenant,
          phone,
          patient_id: patient,
          last_inbound_at: null,
          last_message_at: hoursAgo(12),
        },
      ]),
      insert("messages", [
        {
          tenant_id: tenant,
          conversation_id: demoId(`${slug}:conversation:${patientFile}`),
          patient_id: patient,
          direction: "out",
          kind: "verification_code",
          // Old, used-up code: shown masked.
          body: fill(TEMPLATES.verification_code.bodyAr, { code: "******" }),
          channel: "demo",
          status: "read",
          created_at: hoursAgo(12),
        },
      ]),
      insert("message_dispatches", [
        {
          tenant_id: tenant,
          dedupe_key: `demo:seed:${slug}`,
          kind: "verification_code",
          patient_id: patient,
          outcome: "sent",
          created_at: hoursAgo(12),
        },
      ]),
      insert("webhook_events", [
        { tenant_id: tenant, event_key: `demo-event-${slug}`, created_at: hoursAgo(12) },
      ]),
      insert("notification_prefs", [
        { tenant_id: tenant, user_id: `usr_${adminKey}`, enabled: true },
      ]),
      insert("push_subscriptions", [
        {
          tenant_id: tenant,
          user_id: `usr_${adminKey}`,
          endpoint: `https://${DEMO_PUSH_HOST}/demo-device/${slug}`,
          p256dh: "demo",
          auth: "demo",
          user_agent: "Demo device (never receives anything)",
        },
      ]),
    );
  }
  return out.join("\n");
}

/**
 * Phase 2b WhatsApp story (Derma, all FAKE):
 *  - D-0001: yesterday's reminder for today's 15:30 visit, confirmed with the button;
 *  - D-0011: post-care check-in after a laser session, answered "I have a concern" (needs reply);
 *  - D-0014: sent STOP (opted out);
 *  - D-0019: Botox 125 days ago → a recall is due (the scheduler sends it);
 *  - 0555123456: a new number that isn't a patient yet, asking about prices (needs reply).
 */
function phase2bRows(week: ReturnType<typeof generateDemoWeek>): string {
  const tenant = demoId("tenant:derma");
  const ref = (kind: string, key: string) => demoId(`derma:${kind}:${key}`);
  const p = (file: string) => DERMA.patients.find((x) => x.fileNumber === file)!;
  const first = (file: string) => p(file).fullNameAr.split(" ")[0];
  const out: string[] = [];
  const convo = (key: string) => ref("conversation", key);
  const ago = (h: number) => raw(`now() - interval '${h} hours'`);
  const buttons = (ids: ("confirm" | "reschedule" | "cancel" | "all_good" | "concern")[]) =>
    raw(`'${JSON.stringify(ids.map((id) => ({ id, title: BUTTON_TITLES[id].ar })))}'::jsonb`);

  const reminderAppt = week.find(
    (a) => a.patientFile === "D-0001" && a.dayIndex === 0 && a.time === "15:30",
  );
  const apptId = reminderAppt ? ref("appointment", reminderAppt.key) : null;

  out.push(
    insert("conversations", [
      {
        id: convo("D-0001"),
        tenant_id: tenant,
        phone: p("D-0001").phone,
        patient_id: ref("patient", "D-0001"),
        profile_name: null,
        needs_reply: false,
        last_inbound_at: ago(20),
        last_message_at: ago(20),
        opted_out_at: null,
      },
      {
        id: convo("D-0011"),
        tenant_id: tenant,
        phone: p("D-0011").phone,
        patient_id: ref("patient", "D-0011"),
        profile_name: null,
        needs_reply: true,
        last_inbound_at: ago(3),
        last_message_at: ago(3),
        opted_out_at: null,
      },
      {
        id: convo("D-0014"),
        tenant_id: tenant,
        phone: p("D-0014").phone,
        patient_id: ref("patient", "D-0014"),
        profile_name: null,
        needs_reply: false,
        last_inbound_at: ago(120),
        last_message_at: ago(120),
        opted_out_at: null,
      },
      {
        id: convo("new-0555123456"),
        tenant_id: tenant,
        phone: "0555123456",
        patient_id: null,
        profile_name: "Noura",
        needs_reply: true,
        last_inbound_at: ago(1),
        last_message_at: ago(1),
        opted_out_at: null,
      },
    ]),
  );
  const m = (o: {
    c: string;
    patient: string | null;
    appt?: string | null;
    dir: "in" | "out";
    kind: string;
    body: string;
    buttons?: ReturnType<typeof raw> | null;
    buttonId?: string | null;
    status: string;
    h: number;
    flag?: string | null;
  }) => ({
    tenant_id: tenant,
    conversation_id: convo(o.c),
    patient_id: o.patient ? ref("patient", o.patient) : null,
    appointment_id: o.appt ?? null,
    direction: o.dir,
    kind: o.kind,
    body: o.body,
    buttons: o.buttons ?? null,
    button_id: o.buttonId ?? null,
    channel: "demo",
    status: o.status,
    flag: o.flag ?? null,
    language: "ar",
    created_at: ago(o.h),
    status_at: ago(o.h),
  });
  const laser = SERVICE_TEXTS.laser_hair_removal;
  out.push(
    insert("messages", [
      m({
        c: "D-0001",
        patient: "D-0001",
        appt: apptId,
        dir: "out",
        kind: "reminder",
        status: "read",
        h: 22,
        buttons: buttons(["confirm", "reschedule", "cancel"]),
        body: fill(TEMPLATES.reminder.bodyAr, {
          patient_first_name: first("D-0001"),
          appointment: "موعد فيلر",
          date: "اليوم",
          time: "15:30",
          doctor: "د. سارة العتيبي",
          branch: "فرع الرياض",
          instructions: SERVICE_TEXTS.fillers.preVisitAr,
          consent_note: "",
        }),
      }),
      m({
        c: "D-0001",
        patient: "D-0001",
        appt: apptId,
        dir: "in",
        kind: "inbound_button",
        buttonId: "confirm",
        body: BUTTON_TITLES.confirm.ar,
        status: "received",
        h: 20,
      }),
      m({
        c: "D-0001",
        patient: "D-0001",
        appt: apptId,
        dir: "out",
        kind: "confirm_ack",
        body: REPLIES.confirm_ack.ar,
        status: "read",
        h: 20,
      }),
      m({
        c: "D-0011",
        patient: "D-0011",
        dir: "out",
        kind: "post_care",
        status: "read",
        h: 5,
        buttons: buttons(["all_good", "concern"]),
        body: fill(TEMPLATES.post_care.bodyAr, {
          patient_first_name: first("D-0011"),
          question: laser.postCareAr,
        }),
      }),
      m({
        c: "D-0011",
        patient: "D-0011",
        dir: "in",
        kind: "inbound_button",
        buttonId: "concern",
        body: BUTTON_TITLES.concern.ar,
        status: "received",
        h: 3,
        flag: "concern",
      }),
      m({
        c: "D-0011",
        patient: "D-0011",
        dir: "in",
        kind: "inbound_text",
        body: "يوجد احمرار خفيف في منطقة الساق، هل هذا طبيعي؟",
        status: "received",
        h: 3,
      }),
      m({
        c: "D-0011",
        patient: "D-0011",
        dir: "out",
        kind: "concern_ack",
        body: REPLIES.concern_ack.ar,
        status: "delivered",
        h: 3,
      }),
      m({
        c: "D-0014",
        patient: "D-0014",
        dir: "in",
        kind: "inbound_text",
        body: "إيقاف",
        status: "received",
        h: 120,
      }),
      m({
        c: "D-0014",
        patient: "D-0014",
        dir: "out",
        kind: "stop_ack",
        body: REPLIES.stop_ack.ar,
        status: "read",
        h: 120,
      }),
      m({
        c: "new-0555123456",
        patient: null,
        dir: "in",
        kind: "inbound_text",
        body: "السلام عليكم، كم سعر جلسة ليزر إزالة الشعر للساقين؟",
        status: "received",
        h: 1,
      }),
    ]),
  );
  if (apptId) {
    out.push(
      insert("message_dispatches", [
        {
          tenant_id: tenant,
          dedupe_key: `reminder:${apptId}`,
          kind: "reminder",
          appointment_id: apptId,
          patient_id: ref("patient", "D-0001"),
          outcome: "sent",
          created_at: ago(22),
        },
      ]),
    );
  }
  // D-0019: Botox with Dr. Sara 125 days ago (completed) → recall due (120 days).
  out.push(
    insert("appointments", [
      {
        id: ref("appointment", "d0019-botox-past"),
        tenant_id: tenant,
        branch_id: ref("branch", "riyadh"),
        patient_id: ref("patient", "D-0019"),
        service_id: ref("service", "botox"),
        practitioner_id: ref("member", "derma-dr-sara"),
        room_id: ref("room", "ruh-4"),
        device_id: null,
        starts_at: raw("date_trunc('day', now() - interval '125 days') + interval '8 hours'"),
        ends_at: raw(
          "date_trunc('day', now() - interval '125 days') + interval '8 hours 30 minutes'",
        ),
        blocked_until: raw(
          "date_trunc('day', now() - interval '125 days') + interval '8 hours 40 minutes'",
        ),
        status: "completed",
        reception_note: null,
        cancel_reason: null,
        demo_day_index: null,
        source: "reception",
        created_by: "usr_derma-rec-ruh1",
      },
    ]),
  );
  return out.join("\n");
}
