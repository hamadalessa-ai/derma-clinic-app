/**
 * SQL for the Phase 1 demo data (all FAKE): the demo week of appointments, blocked time,
 * patient packages with payments and used sessions, signed consents and clinical notes.
 * Dates are relative to pg_temp.setup_params.demo_anchor (the day setup.sql is run).
 */
import { createHash } from "node:crypto";
import { contentFingerprint } from "../lib/consents/fingerprint";
import { DEMO_SKIN_PHOTOS } from "./demo-photos";
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
    daysAgo: 89, // signed at the first session, after the package was bought (90 days ago)
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
  // One-off hours changes: Dr. Lina at a conference one Tuesday (day off).
  out.push(
    insert("schedule_exceptions", [
      {
        id: ref("schedule_exception", "lina-conference"),
        tenant_id: tenant,
        member_id: ref("member", "derma-dr-lina"),
        day: "2027-03-16",
        kind: "off",
        note: "مؤتمر",
        created_by: "usr_derma-admin",
      },
    ]),
  );

  // Patient flow times (reception board): arrived 5 min early, in the room on time, done at the
  // end. Dr. Sara's patient in the room is still with her nurse (Huda), so no doctor time yet.
  const flowTimes = (a: ReturnType<typeof generateDemoWeek>[number]) => {
    const step = ["arrived", "in_session", "completed"].indexOf(a.status);
    if (step < 0)
      return { arrived_at: null, in_room_at: null, doctor_at: null, completed_at: null };
    const nurseOnly = a.status === "in_session" && a.doctorKey === "derma-dr-sara";
    return {
      arrived_at: at(a.dayIndex, a.time, -5),
      in_room_at: step >= 1 ? at(a.dayIndex, a.time) : null,
      doctor_at: step >= 1 && !nurseOnly ? at(a.dayIndex, a.time, 2) : null,
      completed_at: step >= 2 ? at(a.dayIndex, a.time, a.durationMinutes) : null,
    };
  };
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
        ...flowTimes(a),
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
  // A posted visit Lamsa's reception already checked out (cash).
  out.push(
    insert("appointments", [
      {
        id: lref("appointment", "past-1"),
        tenant_id: lamsa,
        branch_id: lref("branch", "dammam"),
        patient_id: lref("patient", "L-0002"),
        service_id: lref("service", "facial_treatment"),
        practitioner_id: lref("member", "lamsa-dr-mona"),
        room_id: lref("room", "dmm-1"),
        device_id: null,
        starts_at: at(-1, "11:00"),
        ends_at: at(-1, "11:00", 60),
        blocked_until: at(-1, "11:00", 75),
        status: "completed",
        reception_note: null,
        cancel_reason: null,
        demo_day_index: -1,
        created_by: "usr_lamsa-rec",
      },
    ]),
  );
  // Dental rows for the isolation tests (Lamsa has no dental department).
  out.push(
    insert("dental_chart_entries", [
      {
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        tooth: 21,
        surfaces: "",
        condition: "watch",
        note: null,
        appointment_id: null,
        recorded_by_user_id: "usr_lamsa-dr-mona",
        recorded_by_name: "Lamsa doctor",
      },
    ]),
  );
  out.push(
    insert("dental_plan_items", [
      {
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        tooth: 21,
        surfaces: "",
        service_id: lref("service", "facial_treatment"),
        code: "facial_treatment",
        name_ar: "جلسة تنظيف البشرة",
        name_en: "Facial Treatment",
        price_halalas: 35000,
        status: "planned",
        note: null,
        appointment_id: null,
        done_at: null,
        created_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  );
  out.push(
    insert("lab_cases", [
      {
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        appointment_id: null,
        practitioner_id: lref("member", "lamsa-dr-mona"),
        lab_name: "Lamsa Lab",
        work: "other",
        teeth: "",
        shade: null,
        sent_on: raw("current_date"),
        due_on: raw("current_date + 5"),
        status: "sent",
        notes: null,
        received_at: null,
        fitted_at: null,
        created_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  );
  out.push(
    insert("visit_checkouts", [
      {
        tenant_id: lamsa,
        appointment_id: lref("appointment", "past-1"),
        patient_id: lref("patient", "L-0002"),
        due_halalas: 35000,
        paid_halalas: 35000,
        method: "cash",
        invoice_number: null,
        note: null,
        checked_out_by_user_id: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("visit_charges", [
      {
        tenant_id: lamsa,
        appointment_id: lref("appointment", "today-1"),
        patient_id: lref("patient", "L-0002"),
        service_id: null,
        billing_item_id: lref("billing_item", "SPF50"),
        code: "SPF50",
        name_ar: "واقي شمس SPF 50",
        name_en: "Sunscreen SPF 50",
        quantity: 1,
        unit_price_halalas: 12000,
        added_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  );
  out.push(
    insert("visit_orders", [
      {
        tenant_id: lamsa,
        appointment_id: lref("appointment", "today-1"),
        patient_id: lref("patient", "L-0002"),
        kind: "medication",
        name: "Moisturising cream",
        dose: "Thin layer",
        frequency: "Twice a day",
        duration: "2 weeks",
        created_by_user_id: "usr_lamsa-dr-mona",
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
  // Lamsa: an extra Friday evening clinic.
  out.push(
    insert("schedule_exceptions", [
      {
        id: lref("schedule_exception", "mona-friday"),
        tenant_id: lamsa,
        member_id: lref("member", "lamsa-dr-mona"),
        day: "2027-03-19",
        kind: "hours",
        branch_id: lref("branch", "dammam"),
        start_time: "16:00",
        end_time: "20:00",
        note: "عيادة مسائية إضافية",
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
  // An internal concern note in Lamsa too (so the isolation tests cover concern_events).
  out.push(
    insert("concern_events", [
      {
        tenant_id: lamsa,
        appointment_id: lref("appointment", "today-1"),
        conversation_id: demoId("lamsa:conversation:L-0002"),
        patient_id: lref("patient", "L-0002"),
        kind: "note",
        body: "ملاحظة داخلية تجريبية",
        actor_user_id: "usr_lamsa-dr-mona",
        created_at: daysAgo(1),
      },
    ]),
  );
  out.push(phase2bRows(week));
  out.push(membershipRows());
  out.push(labRows());
  out.push(photoRows());
  out.push(platformBillingRows());
  // Support access given once in each clinic, long expired (so the isolation tests cover the table).
  for (const slug of ["derma", "lamsa"] as const) {
    out.push(
      insert("support_grants", [
        {
          tenant_id: demoId(`tenant:${slug}`),
          granted_by: `usr_${slug}-admin`,
          reason: "Demo: help with setup",
          allow_changes: false,
          expires_at: daysAgo(30),
          created_at: daysAgo(31),
        },
      ]),
    );
  }
  return out.filter(Boolean).join("\n");
}

/**
 * Platform billing in BOTH clinics (sample amounts): last month's statement, paid by bank
 * transfer, and this month's, open and not yet due. Demo clinics are never billed automatically.
 */
function platformBillingRows(): string {
  const riyadhToday = "(now() at time zone 'Asia/Riyadh')::date";
  const thisMonth = `date_trunc('month', ${riyadhToday})::date`;
  const lastMonth = `(date_trunc('month', ${riyadhToday}) - interval '1 month')::date`;
  const out: string[] = [];
  for (const slug of ["derma", "lamsa"] as const) {
    const tenant = demoId(`tenant:${slug}`);
    const paid = demoId(`${slug}:statement:last-month`);
    out.push(
      insert("platform_statements", [
        {
          id: paid,
          tenant_id: tenant,
          number: `${slug.toUpperCase()}-DEMO-1`,
          period_start: raw(lastMonth),
          period_end: raw(`(${thisMonth} - 1)`),
          amount_halalas: 100000,
          vat_halalas: 15000,
          total_halalas: 115000,
          due_on: raw(`(${lastMonth} + 7)`),
          status: "paid",
          paid_at: raw(`(${lastMonth} + 3)::timestamptz`),
          note: "Sample",
          created_by: "usr_platform-owner",
        },
        {
          id: demoId(`${slug}:statement:this-month`),
          tenant_id: tenant,
          number: `${slug.toUpperCase()}-DEMO-2`,
          period_start: raw(thisMonth),
          period_end: raw(`((${thisMonth} + interval '1 month')::date - 1)`),
          amount_halalas: 100000,
          vat_halalas: 15000,
          total_halalas: 115000,
          due_on: raw(`(${riyadhToday} + 10)`),
          status: "issued",
          paid_at: null,
          note: "Sample",
          created_by: "usr_platform-owner",
        },
      ]),
    );
    out.push(
      insert("platform_payments", [
        {
          tenant_id: tenant,
          statement_id: paid,
          amount_halalas: 115000,
          method: "transfer",
          reference: "DEMO-TRANSFER",
          received_on: raw(`(${lastMonth} + 3)`),
          recorded_by: "usr_platform-owner",
        },
      ]),
    );
  }
  return out.join("\n");
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
      insert("push_log", [
        {
          tenant_id: tenant,
          type: "test",
          appointment_id: null,
          user_id: `usr_${adminKey}`,
          outcome: "demo_device",
          status_code: null,
          reason: "demo device (never contacted)",
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
  if (!reminderAppt) throw new Error("demo week: D-0001's 15:30 visit today is missing");
  const apptId = ref("appointment", reminderAppt.key);

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
  // D-0011: laser with Dr. Sara yesterday (completed) → the post-care concern below is about it.
  const d0011Visit = ref("appointment", "d0011-laser-past");
  const yesterdayAt = (hm: string) =>
    raw(`date_trunc('day', now() - interval '1 day') + interval '${hm}'`);
  out.push(
    insert("appointments", [
      {
        id: d0011Visit,
        tenant_id: tenant,
        branch_id: ref("branch", "riyadh"),
        patient_id: ref("patient", "D-0011"),
        service_id: ref("service", "laser_hair_removal"),
        practitioner_id: ref("member", "derma-dr-sara"),
        room_id: ref("room", "ruh-3"),
        device_id: null,
        // 08:00–08:45 Riyadh (05:00 UTC), before the clinic's demo appointments start.
        starts_at: yesterdayAt("5 hours"),
        ends_at: yesterdayAt("5 hours 45 minutes"),
        blocked_until: yesterdayAt("5 hours 55 minutes"),
        status: "completed",
        reception_note: null,
        cancel_reason: null,
        demo_day_index: null,
        source: "reception",
        created_by: "usr_derma-rec-ruh1",
      },
    ]),
  );
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
        appt: d0011Visit,
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
        appt: d0011Visit,
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
        appt: d0011Visit,
        dir: "in",
        kind: "inbound_text",
        body: "يوجد احمرار خفيف في منطقة الساق، هل هذا طبيعي؟",
        status: "received",
        h: 3,
      }),
      m({
        c: "D-0011",
        patient: "D-0011",
        appt: d0011Visit,
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
  // Reception's internal note on D-0011's concern (never sent to the patient).
  out.push(
    insert("concern_events", [
      {
        tenant_id: tenant,
        appointment_id: d0011Visit,
        conversation_id: convo("D-0011"),
        patient_id: ref("patient", "D-0011"),
        kind: "note",
        body: "اتصلنا بالمريضة ولم ترد. نرجو من الدكتورة الاطلاع على الاحمرار.",
        actor_user_id: "usr_derma-rec-ruh1",
        created_at: ago(2),
      },
    ]),
  );
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
  // Invoice codes and orders of that posted visit.
  const botox = DERMA.services.find((x) => x.code === "botox")!;
  out.push(
    insert("visit_charges", [
      {
        tenant_id: tenant,
        appointment_id: ref("appointment", "d0019-botox-past"),
        patient_id: ref("patient", "D-0019"),
        service_id: ref("service", "botox"),
        billing_item_id: null,
        code: "botox",
        name_ar: botox.nameAr,
        name_en: botox.nameEn,
        quantity: 1,
        unit_price_halalas: Math.round(botox.priceSar * 100),
        added_by_user_id: SARA.id,
        created_at: daysAgo(125),
      },
      {
        tenant_id: tenant,
        appointment_id: ref("appointment", "d0019-botox-past"),
        patient_id: ref("patient", "D-0019"),
        service_id: null,
        billing_item_id: ref("billing_item", "BTX-U"),
        code: "BTX-U",
        name_ar: "وحدة بوتوكس",
        name_en: "Botox unit",
        quantity: 20,
        unit_price_halalas: 2500,
        added_by_user_id: SARA.id,
        created_at: daysAgo(125),
      },
    ]),
  );
  out.push(
    insert("visit_orders", [
      {
        tenant_id: tenant,
        appointment_id: ref("appointment", "d0019-botox-past"),
        patient_id: ref("patient", "D-0019"),
        kind: "treatment",
        name: "Botox review and repeat",
        sessions: 1,
        interval_weeks: 16,
        service_id: ref("service", "botox"),
        instructions: "Repeat in about 4 months.",
        created_by_user_id: SARA.id,
        created_at: daysAgo(125),
      },
    ]),
  );
  // Reception checked it out: paid by card, invoice number from the clinic's own system.
  out.push(
    insert("visit_checkouts", [
      {
        tenant_id: tenant,
        appointment_id: ref("appointment", "d0019-botox-past"),
        patient_id: ref("patient", "D-0019"),
        due_halalas: Math.round(botox.priceSar * 100) + 20 * 2500,
        paid_halalas: Math.round(botox.priceSar * 100) + 20 * 2500,
        method: "card",
        invoice_number: "INV-2026-0412",
        note: null,
        checked_out_by_user_id: "usr_derma-rec-ruh1",
        created_at: daysAgo(125),
      },
    ]),
  );

  // Dental: Dr. Nawaf's patient D-0015 — chart, a treatment plan across visits, lab work.
  const NAWAF = { id: "usr_derma-dr-nawaf", name: "د. نواف الحربي" };
  const dentalTooth = (
    t: number,
    condition: string,
    surfaces = "",
    note: string | null = null,
    ago = 40,
  ) => ({
    tenant_id: tenant,
    patient_id: ref("patient", "D-0015"),
    tooth: t,
    surfaces,
    condition,
    note,
    appointment_id: null,
    recorded_by_user_id: NAWAF.id,
    recorded_by_name: NAWAF.name,
    created_at: daysAgo(ago),
  });
  out.push(
    insert("dental_chart_entries", [
      dentalTooth(18, "missing"),
      dentalTooth(28, "missing"),
      dentalTooth(38, "extraction_needed", "", "Impacted wisdom tooth"),
      dentalTooth(36, "caries", "MO", null, 40),
      dentalTooth(36, "filled", "MO", "Composite", 20),
      dentalTooth(46, "crown", "", "Zirconia crown (lab)", 20),
      dentalTooth(25, "caries", "D", "Deep — pulp close", 20),
      dentalTooth(11, "watch", "", "Small chip, check in 6 months", 20),
    ]),
  );
  const dentalSvc = (code: string) => DERMA.services.find((x) => x.code === code)!;
  const dentalPlan = (
    key: string,
    t: number | null,
    code: string,
    status: "planned" | "done",
    surfaces = "",
    ago = 20,
  ) => ({
    id: ref("dental_plan_item", key),
    tenant_id: tenant,
    patient_id: ref("patient", "D-0015"),
    tooth: t,
    surfaces,
    service_id: ref("service", code),
    code,
    name_ar: dentalSvc(code).nameAr,
    name_en: dentalSvc(code).nameEn,
    price_halalas: Math.round(dentalSvc(code).priceSar * 100),
    status,
    note: null,
    appointment_id: null,
    done_at: status === "done" ? daysAgo(ago) : null,
    created_by_user_id: NAWAF.id,
    created_at: daysAgo(40),
  });
  out.push(
    insert("dental_plan_items", [
      dentalPlan("p1", null, "dental_scaling", "done", "", 40),
      dentalPlan("p2", 36, "dental_filling", "done", "MO", 20),
      dentalPlan("p3", 25, "root_canal", "planned"),
      dentalPlan("p4", 25, "dental_crown", "planned"),
      dentalPlan("p5", 38, "dental_extraction", "planned"),
    ]),
  );
  const labRow = (
    key: string,
    file: string,
    work: string,
    teeth: string,
    sentAgo: number,
    dueIn: number,
    status: string,
    labName: string,
  ) => ({
    id: ref("lab_case", key),
    tenant_id: tenant,
    patient_id: ref("patient", file),
    appointment_id: null,
    practitioner_id: ref("member", "derma-dr-nawaf"),
    lab_name: labName,
    work,
    teeth,
    shade: work === "crown" || work === "bridge" ? "A2" : null,
    sent_on: raw(`current_date - ${sentAgo}`),
    due_on: raw(`current_date + ${dueIn}`),
    status,
    notes: null,
    received_at: status === "received" ? daysAgo(1) : null,
    fitted_at: null,
    created_by_user_id: NAWAF.id,
  });
  out.push(
    insert("lab_cases", [
      labRow("l1", "D-0015", "crown", "46", 6, 2, "sent", "معمل الرياض للأسنان"),
      labRow("l2", "D-0009", "bridge", "14–16", 10, -1, "sent", "Smile Lab"),
      labRow("l3", "D-0004", "night_guard", "", 7, 0, "received", "Smile Lab"),
    ]),
  );

  return out.join("\n");
}

/**
 * Memberships (FAKE): three Derma plans and four members — D-0011 ends in 3 days (the WhatsApp
 * renewal reminder), D-0038 in 10 days with money still due, D-0030 yearly, D-0020 lapsed 5 days
 * ago (on the renewals list). Lamsa gets one too (isolation tests).
 */
function membershipRows(): string {
  const tenant = demoId("tenant:derma");
  const ref = (kind: string, key: string) => demoId(`derma:${kind}:${key}`);
  const lamsa = demoId("tenant:lamsa");
  const lref = (kind: string, key: string) => demoId(`lamsa:${kind}:${key}`);
  const day = (n: number) => raw(`${ANCHOR} + ${n}`);
  // The period that ends on anchor + n: starts the day after the same date `months` earlier.
  const startFor = (endIn: number, months: number) =>
    raw(`(${ANCHOR} + ${endIn + 1} - interval '${months} months')::date`);
  const out: string[] = [];

  const plan = (
    key: string,
    nameAr: string,
    nameEn: string,
    sar: number,
    months: number,
    visits: number,
    discount: number,
  ) => ({
    id: ref("membership_plan", key),
    tenant_id: tenant,
    name_ar: nameAr,
    name_en: nameEn,
    price_halalas: sar * 100,
    period_months: months,
    included_service_id: visits ? ref("service", "facial_treatment") : null,
    included_visits: visits,
    discount_percent: discount,
    is_active: true,
  });
  const plans = [
    plan("glow-m", "عضوية النضارة الشهرية", "Glow Monthly", 299, 1, 1, 10),
    plan("glow-y", "عضوية النضارة السنوية", "Glow Yearly", 2990, 12, 12, 15),
    plan("vip-m", "عضوية VIP الشهرية", "VIP Monthly", 499, 1, 0, 20),
  ];
  out.push(insert("membership_plans", plans));

  const member = (key: string, file: string, planKey: string, endIn: number, soldAgo: number) => {
    const p = plans.find((x) => x.id === ref("membership_plan", planKey))!;
    return {
      id: ref("patient_membership", key),
      tenant_id: tenant,
      patient_id: ref("patient", file),
      plan_id: p.id,
      name_ar: p.name_ar,
      name_en: p.name_en,
      price_halalas: p.price_halalas,
      period_months: p.period_months,
      included_service_id: p.included_service_id,
      included_visits: p.included_visits,
      discount_percent: p.discount_percent,
      starts_on: startFor(endIn, p.period_months),
      ends_on: day(endIn),
      renews_id: null,
      sold_by_user_id: "usr_derma-rec-ruh1",
      created_at: daysAgo(soldAgo),
    };
  };
  const members = [
    member("d0011", "D-0011", "glow-m", 3, 27),
    member("d0038", "D-0038", "vip-m", 10, 20),
    member("d0030", "D-0030", "glow-y", 265, 100),
    member("d0020", "D-0020", "glow-m", -5, 35),
  ];
  out.push(insert("patient_memberships", members));
  const pay = (key: string, sar: number, method: string, invoice: string, ago: number) => ({
    tenant_id: tenant,
    patient_membership_id: ref("patient_membership", key),
    amount_halalas: sar * 100,
    method,
    invoice_number: invoice,
    recorded_by_user_id: "usr_derma-rec-ruh1",
    created_at: daysAgo(ago),
  });
  out.push(
    insert("membership_payments", [
      pay("d0011", 299, "card", "INV-2026-0501", 27),
      pay("d0038", 200, "cash", "INV-2026-0533", 20),
      pay("d0030", 2990, "transfer", "INV-2026-0388", 100),
      pay("d0020", 299, "card", "INV-2026-0470", 35),
    ]),
  );

  // D-0011's included facial this period (a completed visit 16 working days ago).
  out.push(
    insert("appointments", [
      {
        id: ref("appointment", "d0011-facial-member"),
        tenant_id: tenant,
        branch_id: ref("branch", "riyadh"),
        patient_id: ref("patient", "D-0011"),
        service_id: ref("service", "facial_treatment"),
        practitioner_id: ref("member", "derma-dr-sara"),
        room_id: ref("room", "ruh-4"),
        device_id: null,
        starts_at: at(-16, "08:00"),
        ends_at: at(-16, "08:00", 60),
        blocked_until: at(-16, "08:00", 75),
        status: "completed",
        reception_note: null,
        cancel_reason: null,
        demo_day_index: -16,
        source: "reception",
        created_by: "usr_derma-rec-ruh1",
      },
    ]),
  );
  out.push(
    insert("membership_visits", [
      {
        tenant_id: tenant,
        patient_membership_id: ref("patient_membership", "d0011"),
        appointment_id: ref("appointment", "d0011-facial-member"),
      },
    ]),
  );

  // Lamsa: one plan, one member, one included visit.
  out.push(
    insert("membership_plans", [
      {
        id: lref("membership_plan", "care"),
        tenant_id: lamsa,
        name_ar: "عضوية لمسة",
        name_en: "Lamsa Care",
        price_halalas: 19900,
        period_months: 1,
        included_service_id: lref("service", "facial_treatment"),
        included_visits: 1,
        discount_percent: 10,
        is_active: true,
      },
    ]),
  );
  out.push(
    insert("patient_memberships", [
      {
        id: lref("patient_membership", "l0002"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        plan_id: lref("membership_plan", "care"),
        name_ar: "عضوية لمسة",
        name_en: "Lamsa Care",
        price_halalas: 19900,
        period_months: 1,
        included_service_id: lref("service", "facial_treatment"),
        included_visits: 1,
        discount_percent: 10,
        starts_on: startFor(15, 1),
        ends_on: day(15),
        renews_id: null,
        sold_by_user_id: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("membership_payments", [
      {
        tenant_id: lamsa,
        patient_membership_id: lref("patient_membership", "l0002"),
        amount_halalas: 19900,
        method: "card",
        invoice_number: null,
        recorded_by_user_id: "usr_lamsa-rec",
      },
    ]),
  );
  out.push(
    insert("membership_visits", [
      {
        tenant_id: lamsa,
        patient_membership_id: lref("patient_membership", "l0002"),
        appointment_id: lref("appointment", "past-1"),
      },
    ]),
  );
  return out.join("\n");
}

/**
 * Lab results (FAKE): D-0012 on an acne course — liver and lipids 2 months ago (triglycerides
 * high), ferritin and vitamin D 10 days ago (both low), a repeat of ALT + triglycerides due soon
 * and a vitamin B12 repeat already overdue. Lamsa has one report (isolation tests).
 */
function labRows(): string {
  const tenant = demoId("tenant:derma");
  const ref = (kind: string, key: string) => demoId(`derma:${kind}:${key}`);
  const lamsa = demoId("tenant:lamsa");
  const lref = (kind: string, key: string) => demoId(`lamsa:${kind}:${key}`);
  const day = (n: number) => raw(`${ANCHOR} + ${n}`);
  const out: string[] = [];
  const report = (key: string, ago: number, lab: string) => ({
    id: ref("lab_report", key),
    tenant_id: tenant,
    patient_id: ref("patient", "D-0012"),
    appointment_id: null,
    taken_on: day(-ago),
    lab_name: lab,
    note: null,
    file_id: null,
    entered_by_user_id: "usr_derma-dr-sara",
  });
  out.push(
    insert("lab_reports", [report("d12-a", 60, "Al Borg Lab"), report("d12-b", 10, "Al Borg Lab")]),
  );
  const value = (
    key: string,
    pos: number,
    test: string,
    text: string,
    unit: string,
    low: number | null,
    high: number | null,
    flag: string,
  ) => ({
    tenant_id: tenant,
    report_id: ref("lab_report", key),
    position: pos,
    test_name: test,
    value_text: text,
    value_num: Number(text),
    unit,
    ref_low: low,
    ref_high: high,
    flag,
  });
  out.push(
    insert("lab_values", [
      value("d12-a", 0, "ALT", "38", "U/L", 7, 56, "normal"),
      value("d12-a", 1, "AST", "29", "U/L", 10, 40, "normal"),
      value("d12-a", 2, "Triglycerides", "182", "mg/dL", null, 150, "high"),
      value("d12-a", 3, "Total cholesterol", "176", "mg/dL", null, 200, "normal"),
      value("d12-b", 0, "Ferritin", "14", "ng/mL", 30, 400, "low"),
      value("d12-b", 1, "Vitamin D (25-OH)", "19", "ng/mL", 30, 100, "low"),
      value("d12-b", 2, "Hemoglobin", "12.9", "g/dL", 12, 17.5, "normal"),
    ]),
  );
  const request = (test: string, due: number, reason: string | null) => ({
    tenant_id: tenant,
    patient_id: ref("patient", "D-0012"),
    appointment_id: null,
    test_name: test,
    due_on: day(due),
    reason,
    requested_by_user_id: "usr_derma-dr-sara",
  });
  out.push(
    insert("lab_requests", [
      request("ALT", 20, "Monthly on the acne course"),
      request("Triglycerides", 20, "Monthly on the acne course"),
      request("Vitamin B12", -3, null),
    ]),
  );

  out.push(
    insert("lab_reports", [
      {
        id: lref("lab_report", "l2"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        appointment_id: null,
        taken_on: day(-7),
        lab_name: null,
        note: null,
        file_id: null,
        entered_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  );
  out.push(
    insert("lab_values", [
      {
        tenant_id: lamsa,
        report_id: lref("lab_report", "l2"),
        position: 0,
        test_name: "TSH",
        value_text: "2.1",
        value_num: 2.1,
        unit: "mIU/L",
        ref_low: 0.4,
        ref_high: 4,
        flag: "normal",
      },
    ]),
  );
  out.push(
    insert("lab_requests", [
      {
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        appointment_id: null,
        test_name: "TSH",
        due_on: day(90),
        reason: null,
        requested_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  );
  return out.join("\n");
}

/**
 * Before / after photos (FAKE: drawn skin textures, not real people): D-0013 on a laser
 * pigmentation course with Dr. Faisal — cheeks and forehead 12 weeks ago and 3 days ago, the
 * patches lighter after. Lamsa has one photo (isolation tests).
 */
function photoRows(): string {
  const tenant = demoId("tenant:derma");
  const lamsa = demoId("tenant:lamsa");
  const ref = (kind: string, key: string) => demoId(`derma:${kind}:${key}`);
  const lref = (kind: string, key: string) => demoId(`lamsa:${kind}:${key}`);
  const day = (n: number) => raw(`${ANCHOR} + ${n}`);
  const file = (id: string, tenantId: string, key: keyof typeof DEMO_SKIN_PHOTOS, by: string) => {
    const data = Buffer.from(DEMO_SKIN_PHOTOS[key], "base64");
    return {
      id,
      tenant_id: tenantId,
      kind: "clinical_photo",
      mime_type: "image/jpeg",
      size_bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      data: raw(`decode('${DEMO_SKIN_PHOTOS[key]}', 'base64')`),
      created_by: by,
    };
  };
  const shots: { key: keyof typeof DEMO_SKIN_PHOTOS; area: string; ago: number }[] = [
    { key: "cheek-before", area: "cheeks", ago: 84 },
    { key: "forehead-before", area: "forehead", ago: 84 },
    { key: "cheek-after", area: "cheeks", ago: 3 },
    { key: "forehead-after", area: "forehead", ago: 3 },
  ];
  const by = "usr_derma-dr-faisal";
  return [
    insert("files", [
      ...shots.map((p) => file(ref("file", `photo-${p.key}`), tenant, p.key, by)),
      file(lref("file", "photo-l1"), lamsa, "cheek-before", "usr_lamsa-dr-mona"),
    ]),
    insert("clinical_photos", [
      ...shots.map((p) => ({
        id: ref("clinical_photo", p.key),
        tenant_id: tenant,
        patient_id: ref("patient", "D-0013"),
        appointment_id: null,
        file_id: ref("file", `photo-${p.key}`),
        area: p.area,
        view: "front",
        taken_on: day(-p.ago),
        note: p.ago > 30 ? "Before session 1" : "After session 4",
        taken_by_user_id: by,
      })),
      {
        id: lref("clinical_photo", "l1"),
        tenant_id: lamsa,
        patient_id: lref("patient", "L-0002"),
        appointment_id: null,
        file_id: lref("file", "photo-l1"),
        area: "face",
        view: "front",
        taken_on: day(-5),
        note: null,
        taken_by_user_id: "usr_lamsa-dr-mona",
      },
    ]),
  ].join("\n");
}
