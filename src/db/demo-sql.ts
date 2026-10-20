/**
 * SQL for the Phase 1 demo data (all FAKE): the demo week of appointments, blocked time,
 * patient packages with payments and used sessions, signed consents and clinical notes.
 * Dates are relative to pg_temp.setup_params.demo_anchor (the day setup.sql is run).
 */
import { createHash } from "node:crypto";
import { contentFingerprint } from "../lib/consents/fingerprint";
import { DEMO_SIGNATURE_PNG_BASE64, DEMO_TIME_BLOCKS, generateDemoWeek } from "./demo-week";
import { CONSENT_TEMPLATES, demoId, PACKAGE_TEMPLATES } from "./seed-data";
import { insert, raw } from "./sql-render";

const ANCHOR = "(select demo_anchor from pg_temp.setup_params)";
const at = (dayIndex: number, time: string, plusMinutes = 0) =>
  raw(
    `((public.demo_workday(${ANCHOR}, ${dayIndex}) + time '${time}') at time zone 'Asia/Riyadh')` +
      (plusMinutes ? ` + interval '${plusMinutes} minutes'` : ""),
  );
const daysAgo = (n: number) => raw(`now() - interval '${n} days'`);

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

export const DEMO_CONSENTS = [
  {
    key: "d0011-lhr",
    patientFile: "D-0011",
    code: "laser_hair_removal",
    signer: "شهد صالح الحربي",
    daysAgo: 90,
  },
  {
    key: "d0015-peel",
    patientFile: "D-0015",
    code: "chemical_peel",
    signer: "مها سليمان القحطاني",
    daysAgo: 30,
  },
  {
    key: "d0004-inj",
    patientFile: "D-0004",
    code: "injectables",
    signer: "لمى إبراهيم المطيري",
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
        created_by: "usr_derma-rec-ruh1",
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
  return out.filter(Boolean).join("\n");
}
