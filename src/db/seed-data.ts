/**
 * Demo seed data — ALL FAKE. Names, phone numbers and dates of birth are invented.
 * Prices and durations are rough demo estimates, not real clinic prices.
 *
 * IDs are deterministic (derived from a readable key) so db/setup.sql is reproducible
 * and tests can refer to known records.
 */
import { createHash } from "node:crypto";
import { DERMA_SITE } from "./site-derma";

/** Deterministic UUID (v5-style) from a readable key. */
export function demoId(key: string): string {
  const h = createHash("sha1").update(`derma-demo:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Role = "clinic_admin" | "practitioner" | "receptionist";

export interface SeedStaff {
  key: string;
  email: string;
  nameAr: string;
  nameEn: string;
  roles: Role[];
  branch: string | null; // branch key; null = all branches
  titleAr: string;
  titleEn: string;
}

export interface SeedService {
  code: string;
  nameAr: string;
  nameEn: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceSar: number;
  requiredDeviceType: string | null;
  /** A video consultation (booked in the branch's video room). */
  isVirtual?: boolean;
}

export interface SeedPatient {
  fileNumber: string;
  fullNameAr: string;
  fullNameEn: string;
  phone: string;
  gender: "male" | "female";
  dateOfBirth: string;
  idType: "national_id" | "iqama";
  /** FAKE: 10 digits, national IDs start with 1, Iqamas with 2. */
  idNumber: string;
  guardian?: { fileNumber: string; relationAr: string; relationEn: string };
}

export interface SeedMedicalFlag {
  fileNumber: string;
  kind: "allergy" | "contraindication" | "medication";
  label: string;
  note?: string;
}

export interface SeedTenant {
  slug: string;
  nameAr: string;
  nameEn: string;
  brandColor: string;
  branches: { key: string; nameAr: string; nameEn: string; cityAr: string; cityEn: string }[];
  departments: { code: string; nameAr: string; nameEn: string; isActive: boolean }[];
  rooms: { key: string; branch: string; nameAr: string; nameEn: string }[];
  devices: {
    key: string;
    branch: string;
    room: string | null;
    deviceType: string;
    nameAr: string;
    nameEn: string;
  }[];
  staff: SeedStaff[];
  services: SeedService[]; // all in the "dermatology" department
  patients: SeedPatient[];
}

export const PLATFORM_OWNER = {
  key: "platform-owner",
  email: "owner@platform.demo",
  nameAr: "مالك المنصة",
  nameEn: "Platform Owner",
};

// ─── Services (demo estimates) ──────────────────────────────────────────────

const S = (
  code: string,
  nameAr: string,
  nameEn: string,
  durationMinutes: number,
  bufferMinutes: number,
  priceSar: number,
  requiredDeviceType: string | null = null,
): SeedService => ({
  code,
  nameAr,
  nameEn,
  durationMinutes,
  bufferMinutes,
  priceSar,
  requiredDeviceType,
});

export const DERMA_SERVICES: SeedService[] = [
  S("consultation", "استشارة طبية", "Consultation", 20, 10, 300),
  S("botox", "بوتوكس", "Botox", 30, 10, 1200),
  S("fillers", "فيلر", "Fillers", 45, 15, 1800),
  S("skin_boosters", "محفزات البشرة (سكين بوستر)", "Skin Boosters", 45, 15, 1500),
  S("exosomes", "الإكسوسومات", "Exosomes", 45, 15, 1800),
  S("chemical_peeling", "التقشير الكيميائي", "Chemical Peeling", 45, 15, 600),
  S("facial_treatment", "جلسة تنظيف البشرة", "Facial Treatment", 60, 15, 450),
  S("skin_rejuvenation", "نضارة البشرة", "Skin Rejuvenation", 60, 15, 900),
  S("prp", "البلازما (PRP)", "PRP", 45, 15, 900),
  S("prf", "البلازما الغنية بالفيبرين (PRF)", "PRF", 45, 15, 1100),
  S("thread_lift", "شد الوجه بالخيوط", "Thread Lift", 90, 30, 3500),
  S("mesotherapy", "الميزوثيرابي", "Mesotherapy", 45, 15, 700),
  S(
    "fractional_laser",
    "الليزر التجزيئي (فراكشنال)",
    "Fractional Laser",
    60,
    15,
    1500,
    "fractional_laser",
  ),
  S("morpheus8", "مورفيس 8", "Morpheus8", 75, 15, 2500, "morpheus8"),
  S("scarlet_rf", "سكارليت RF", "Scarlet RF", 60, 15, 2200, "scarlet_rf"),
  S("vascular_laser", "ليزر الأوعية الدموية", "Vascular Laser", 30, 10, 900, "vascular_laser"),
  S(
    "laser_pigmentation",
    "ليزر إزالة التصبغات",
    "Laser Pigmentation Removal",
    45,
    15,
    1000,
    "pico_laser",
  ),
  S("laser_tattoo", "ليزر إزالة الوشم", "Laser Tattoo Removal", 30, 10, 800, "pico_laser"),
  S("ultherapy", "ألثيرابي", "Ultherapy", 90, 15, 6000, "ultherapy"),
  S(
    "laser_hair_removal",
    "ليزر إزالة الشعر",
    "Laser Hair Removal",
    60,
    15,
    800,
    "hair_removal_laser",
  ),
  S("cryotherapy", "العلاج بالتبريد", "Cryotherapy", 30, 10, 400),
  S("patch_test", "اختبار الحساسية", "Patch Test", 15, 5, 100),
  {
    ...S("video_consultation", "استشارة مرئية (فيديو)", "Video Consultation", 20, 10, 250),
    isVirtual: true,
  },
];

/**
 * Video rooms: one per branch that offers video consultations. Not real rooms — they are never
 * reserved (db/booking.sql), so several video visits can run at once; the doctor is reserved.
 */
export const VIRTUAL_ROOMS: Record<
  string,
  { key: string; branch: string; nameAr: string; nameEn: string }[]
> = {
  derma: [
    {
      key: "ruh-video",
      branch: "riyadh",
      nameAr: "الاستشارات المرئية",
      nameEn: "Video Consultations",
    },
    {
      key: "jed-video",
      branch: "jeddah",
      nameAr: "الاستشارات المرئية",
      nameEn: "Video Consultations",
    },
  ],
};

// ─── Fake patients ──────────────────────────────────────────────────────────

const FEMALE = [
  ["نورة", "Noura"],
  ["سارة", "Sarah"],
  ["ريم", "Reem"],
  ["لمى", "Lama"],
  ["جود", "Joud"],
  ["هيا", "Haya"],
  ["العنود", "Alanoud"],
  ["دانة", "Dana"],
  ["رهف", "Rahaf"],
  ["شهد", "Shahad"],
  ["غادة", "Ghada"],
  ["منيرة", "Munira"],
  ["أروى", "Arwa"],
  ["لجين", "Lujain"],
  ["مها", "Maha"],
  ["وعد", "Waad"],
  ["بشاير", "Bashayer"],
  ["ديما", "Dima"],
  ["تالا", "Tala"],
  ["نوف", "Nouf"],
  ["أسيل", "Aseel"],
  ["ريناد", "Renad"],
  ["خلود", "Kholoud"],
  ["فاطمة", "Fatimah"],
] as const;
const MALE = [
  ["محمد", "Mohammed"],
  ["عبدالله", "Abdullah"],
  ["فهد", "Fahad"],
  ["سلطان", "Sultan"],
  ["تركي", "Turki"],
  ["خالد", "Khaled"],
  ["ناصر", "Nasser"],
  ["بندر", "Bandar"],
  ["يزيد", "Yazeed"],
  ["مشعل", "Mishal"],
  ["راكان", "Rakan"],
  ["عمر", "Omar"],
  ["سعود", "Saud"],
  ["زياد", "Ziyad"],
  ["ماجد", "Majed"],
  ["وليد", "Waleed"],
] as const;
const FATHERS = [
  ["عبدالرحمن", "Abdulrahman"],
  ["إبراهيم", "Ibrahim"],
  ["سليمان", "Sulaiman"],
  ["أحمد", "Ahmed"],
  ["علي", "Ali"],
  ["حمد", "Hamad"],
  ["صالح", "Saleh"],
  ["يوسف", "Yousef"],
] as const;
const FAMILIES = [
  ["القحطاني", "Al-Qahtani"],
  ["العتيبي", "Al-Otaibi"],
  ["الدوسري", "Al-Dosari"],
  ["الشهري", "Al-Shehri"],
  ["الغامدي", "Al-Ghamdi"],
  ["الزهراني", "Al-Zahrani"],
  ["المطيري", "Al-Mutairi"],
  ["الحربي", "Al-Harbi"],
  ["العنزي", "Al-Anazi"],
  ["الشمري", "Al-Shammari"],
  ["السبيعي", "Al-Subaie"],
  ["البقمي", "Al-Buqami"],
  ["الرشيد", "Al-Rasheed"],
  ["التميمي", "Al-Tamimi"],
  ["الجهني", "Al-Juhani"],
] as const;

/**
 * Builds fake patients. Phone numbers follow the obviously-fake pattern 0500 PP NNNN (10 digits)
 * (PP = clinic prefix), dates of birth are spread over 1970–2005.
 */
export function makeFakePatients(
  count: number,
  filePrefix: string,
  phonePrefix: string,
  offset = 0,
): SeedPatient[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + offset;
    const isFemale = n % 10 < 7; // ~70% female, typical for aesthetic clinics
    const [firstAr, firstEn] = isFemale ? FEMALE[n % FEMALE.length] : MALE[n % MALE.length];
    const [fatherAr, fatherEn] = FATHERS[(n * 3) % FATHERS.length];
    const [familyAr, familyEn] = FAMILIES[(n * 7) % FAMILIES.length];
    const year = 1970 + ((n * 13) % 36);
    const month = ((n * 5) % 12) + 1;
    const day = ((n * 11) % 28) + 1;
    const isIqama = n % 9 === 4; // a few residents
    return {
      fileNumber: `${filePrefix}-${String(i + 1).padStart(4, "0")}`,
      fullNameAr: `${firstAr} ${fatherAr} ${familyAr}`,
      fullNameEn: `${firstEn} ${fatherEn} ${familyEn}`,
      phone: `0500${phonePrefix}${String(i + 1).padStart(4, "0")}`,
      gender: isFemale ? "female" : "male",
      dateOfBirth: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      idType: isIqama ? "iqama" : "national_id",
      idNumber: `${isIqama ? 2 : 1}00000${phonePrefix}${String(i + 1).padStart(2, "0")}`,
    };
  });
}

/** A family: D-0008 (Bandar Al-Ghamdi) is the guardian of his two children. */
function withFamily(patients: SeedPatient[]): SeedPatient[] {
  const child = (
    fileNumber: string,
    c: Partial<SeedPatient>,
    relationAr: string,
    relationEn: string,
  ) => {
    const p = patients.find((x) => x.fileNumber === fileNumber)!;
    Object.assign(p, c, { guardian: { fileNumber: "D-0008", relationAr, relationEn } });
  };
  child(
    "D-0039",
    {
      fullNameAr: "ليان بندر الغامدي",
      fullNameEn: "Layan Bandar Al-Ghamdi",
      gender: "female",
      dateOfBirth: "2014-03-09",
    },
    "ابنة",
    "Daughter",
  );
  child(
    "D-0040",
    {
      fullNameAr: "سلمان بندر الغامدي",
      fullNameEn: "Salman Bandar Al-Ghamdi",
      gender: "male",
      dateOfBirth: "2011-11-20",
    },
    "ابن",
    "Son",
  );
  return patients;
}

/** Allergies, contraindications and medications (shown as warning badges). */
export const DERMA_MEDICAL_FLAGS: SeedMedicalFlag[] = [
  {
    fileNumber: "D-0001",
    kind: "allergy",
    label: "ليدوكايين (مخدر موضعي) · Lidocaine",
    note: "طفح جلدي سابق",
  },
  { fileNumber: "D-0003", kind: "allergy", label: "البنسلين · Penicillin" },
  { fileNumber: "D-0006", kind: "contraindication", label: "حمل · Pregnancy" },
  { fileNumber: "D-0010", kind: "medication", label: "إيزوتريتينوين (روكتان) · Isotretinoin" },
  {
    fileNumber: "D-0010",
    kind: "contraindication",
    label: "لا ليزر ولا تقشير أثناء الروكتان · No laser/peel on isotretinoin",
  },
  { fileNumber: "D-0014", kind: "allergy", label: "اللاتكس · Latex" },
  { fileNumber: "D-0021", kind: "medication", label: "مميعات الدم (وارفارين) · Warfarin" },
];

// ─── Clinic A: Derma Clinics ────────────────────────────────────────────────

const doctor = (
  key: string,
  email: string,
  nameAr: string,
  nameEn: string,
  branch: string,
): SeedStaff => ({
  key,
  email,
  nameAr,
  nameEn,
  roles: ["practitioner"],
  branch,
  titleAr: "طبيب جلدية وتجميل",
  titleEn: "Dermatologist",
});

const reception = (
  key: string,
  email: string,
  nameAr: string,
  nameEn: string,
  branch: string,
): SeedStaff => ({
  key,
  email,
  nameAr,
  nameEn,
  roles: ["receptionist"],
  branch,
  titleAr: "موظف استقبال",
  titleEn: "Receptionist",
});

export const DERMA: SeedTenant = {
  slug: "derma",
  nameAr: "عيادات ديرما",
  nameEn: "Derma Clinics",
  brandColor: "#0b5d4c", // deep emerald: website, booking and app share one accent
  branches: [
    {
      key: "riyadh",
      nameAr: "فرع الرياض",
      nameEn: "Riyadh Branch",
      cityAr: "الرياض",
      cityEn: "Riyadh",
    },
    { key: "jeddah", nameAr: "فرع جدة", nameEn: "Jeddah Branch", cityAr: "جدة", cityEn: "Jeddah" },
  ],
  departments: [
    {
      code: "dermatology",
      nameAr: "الجلدية والتجميل",
      nameEn: "Dermatology & Aesthetics",
      isActive: true,
    },
    { code: "dental", nameAr: "الأسنان", nameEn: "Dental", isActive: false },
    {
      code: "plastic_surgery",
      nameAr: "الجراحة التجميلية",
      nameEn: "Plastic Surgery",
      isActive: false,
    },
    {
      code: "hair_restoration",
      nameAr: "زراعة الشعر",
      nameEn: "Hair Restoration",
      isActive: false,
    },
  ],
  rooms: [
    { key: "ruh-1", branch: "riyadh", nameAr: "غرفة الكشف 1", nameEn: "Consultation Room 1" },
    { key: "ruh-2", branch: "riyadh", nameAr: "غرفة الكشف 2", nameEn: "Consultation Room 2" },
    { key: "ruh-3", branch: "riyadh", nameAr: "غرفة الليزر", nameEn: "Laser Room" },
    { key: "ruh-4", branch: "riyadh", nameAr: "غرفة الإجراءات", nameEn: "Procedure Room" },
    { key: "jed-1", branch: "jeddah", nameAr: "غرفة الكشف", nameEn: "Consultation Room" },
    { key: "jed-2", branch: "jeddah", nameAr: "غرفة الليزر", nameEn: "Laser Room" },
  ],
  devices: [
    {
      key: "ruh-lhr",
      branch: "riyadh",
      room: "ruh-3",
      deviceType: "hair_removal_laser",
      nameAr: "جهاز ليزر إزالة الشعر",
      nameEn: "Laser Hair Removal",
    },
    {
      key: "ruh-frac",
      branch: "riyadh",
      room: "ruh-3",
      deviceType: "fractional_laser",
      nameAr: "جهاز الليزر التجزيئي",
      nameEn: "Fractional Laser",
    },
    {
      key: "ruh-m8",
      branch: "riyadh",
      room: "ruh-4",
      deviceType: "morpheus8",
      nameAr: "جهاز مورفيس 8",
      nameEn: "Morpheus8",
    },
    {
      key: "ruh-ulth",
      branch: "riyadh",
      room: "ruh-4",
      deviceType: "ultherapy",
      nameAr: "جهاز ألثيرابي",
      nameEn: "Ultherapy",
    },
    {
      key: "ruh-scarlet",
      branch: "riyadh",
      room: "ruh-4",
      deviceType: "scarlet_rf",
      nameAr: "جهاز سكارليت RF",
      nameEn: "Scarlet RF",
    },
    {
      key: "ruh-vascular",
      branch: "riyadh",
      room: "ruh-3",
      deviceType: "vascular_laser",
      nameAr: "جهاز ليزر الأوعية الدموية",
      nameEn: "Vascular Laser",
    },
    {
      key: "ruh-pico",
      branch: "riyadh",
      room: "ruh-3",
      // One pico laser covers both pigmentation and tattoo removal.
      deviceType: "pico_laser",
      nameAr: "جهاز بيكو ليزر",
      nameEn: "Pico Laser",
    },
    {
      key: "jed-lhr",
      branch: "jeddah",
      room: "jed-2",
      deviceType: "hair_removal_laser",
      nameAr: "جهاز ليزر إزالة الشعر",
      nameEn: "Laser Hair Removal",
    },
  ],
  staff: [
    {
      key: "derma-admin",
      email: "admin@derma.demo",
      nameAr: "نوال القحطاني",
      nameEn: "Nawal Al-Qahtani",
      roles: ["clinic_admin"],
      branch: null,
      titleAr: "مديرة العيادات",
      titleEn: "Clinic Manager",
    },
    doctor(
      "derma-dr-sara",
      "dr.sara@derma.demo",
      "د. سارة العتيبي",
      "Dr. Sarah Al-Otaibi",
      "riyadh",
    ),
    doctor(
      "derma-dr-faisal",
      "dr.faisal@derma.demo",
      "د. فيصل الدوسري",
      "Dr. Faisal Al-Dosari",
      "riyadh",
    ),
    doctor("derma-dr-reem", "dr.reem@derma.demo", "د. ريم الشهري", "Dr. Reem Al-Shehri", "riyadh"),
    reception(
      "derma-rec-ruh1",
      "reception.riyadh1@derma.demo",
      "هند المطيري",
      "Hind Al-Mutairi",
      "riyadh",
    ),
    reception(
      "derma-rec-ruh2",
      "reception.riyadh2@derma.demo",
      "عبدالله الحربي",
      "Abdullah Al-Harbi",
      "riyadh",
    ),
    doctor("derma-dr-lina", "dr.lina@derma.demo", "د. لينا باناجة", "Dr. Lina Banaja", "jeddah"),
    doctor(
      "derma-dr-majed",
      "dr.majed@derma.demo",
      "د. ماجد الغامدي",
      "Dr. Majed Al-Ghamdi",
      "jeddah",
    ),
    reception(
      "derma-rec-jed",
      "reception.jeddah@derma.demo",
      "أمل الزهراني",
      "Amal Al-Zahrani",
      "jeddah",
    ),
  ],
  services: DERMA_SERVICES,
  patients: withFamily(makeFakePatients(40, "D", "01")),
};

// ─── Clinic B: Lamsa Clinic (small, exists to prove isolation) ──────────────

export const LAMSA: SeedTenant = {
  slug: "lamsa",
  nameAr: "عيادة لمسة",
  nameEn: "Lamsa Clinic",
  brandColor: "#8a4f9e",
  branches: [
    {
      key: "dammam",
      nameAr: "فرع الدمام",
      nameEn: "Dammam Branch",
      cityAr: "الدمام",
      cityEn: "Dammam",
    },
  ],
  departments: [
    {
      code: "dermatology",
      nameAr: "الجلدية والتجميل",
      nameEn: "Dermatology & Aesthetics",
      isActive: true,
    },
  ],
  rooms: [{ key: "dmm-1", branch: "dammam", nameAr: "غرفة الكشف", nameEn: "Consultation Room" }],
  devices: [
    {
      key: "dmm-lhr",
      branch: "dammam",
      room: "dmm-1",
      deviceType: "hair_removal_laser",
      nameAr: "جهاز ليزر إزالة الشعر",
      nameEn: "Laser Hair Removal",
    },
  ],
  staff: [
    {
      key: "lamsa-admin",
      email: "admin@lamsa.demo",
      nameAr: "خالد العنزي",
      nameEn: "Khaled Al-Anazi",
      roles: ["clinic_admin"],
      branch: null,
      titleAr: "مدير العيادة",
      titleEn: "Clinic Manager",
    },
    doctor("lamsa-dr-mona", "dr.mona@lamsa.demo", "د. منى السبيعي", "Dr. Mona Al-Subaie", "dammam"),
    reception("lamsa-rec", "reception@lamsa.demo", "سعد الشمري", "Saad Al-Shammari", "dammam"),
  ],
  services: DERMA_SERVICES.filter((s) =>
    ["consultation", "botox", "fillers", "facial_treatment"].includes(s.code),
  ),
  patients: makeFakePatients(8, "L", "02", 17),
};

export const LAMSA_MEDICAL_FLAGS: SeedMedicalFlag[] = [
  { fileNumber: "L-0001", kind: "allergy", label: "الأسبرين · Aspirin" },
];

export const SEED_TENANTS = [DERMA, LAMSA];

/** Working hours for practitioners and receptionists: Sunday–Thursday 10:00–19:00. */
/** Saturday–Thursday (Friday off), common for Saudi aesthetic clinics. 0 = Sunday … 6 = Saturday. */
export const WORK_WEEK = [6, 0, 1, 2, 3, 4];
export const WORK_HOURS = { start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" };

/** Clinic setting: do doctors move their own appointments (true) or send requests (false)? */
export const DOCTORS_MANAGE_OWN_SCHEDULE: Record<string, boolean> = { derma: false, lamsa: true };

/** Clinic-wide closed days (demo). */
export const HOLIDAYS = [
  { day: "2026-09-23", nameAr: "اليوم الوطني السعودي", nameEn: "Saudi National Day" },
  { day: "2027-02-22", nameAr: "يوم التأسيس", nameEn: "Founding Day" },
];

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 demo data
// ════════════════════════════════════════════════════════════════════════════

/** Which consent each service needs (service code → consent template code). */
export const SERVICE_CONSENTS: Record<string, string> = {
  laser_hair_removal: "laser_hair_removal",
  botox: "injectables",
  fillers: "injectables",
  chemical_peeling: "chemical_peel",
  video_consultation: "telehealth",
};

const DEMO_NOTICE_AR = "تنبيه: صياغة تجريبية لأغراض العرض فقط — ليست نصًا قانونيًا معتمدًا.";
const DEMO_NOTICE_EN = "Notice: demo wording for demonstration only — NOT legal text.";

export interface SeedConsentTemplate {
  code: string;
  /** When a new signature is needed (src/lib/consents/rules.ts). */
  rule: "every_visit" | "per_package" | "months";
  /** For rule "months": a signature stays valid this many months. */
  months?: number;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}

export const CONSENT_TEMPLATES: SeedConsentTemplate[] = [
  {
    code: "laser_hair_removal",
    rule: "per_package",
    titleAr: "نموذج موافقة على جلسات ليزر إزالة الشعر",
    titleEn: "Consent for Laser Hair Removal sessions",
    bodyAr: [
      DEMO_NOTICE_AR,
      "أقرّ بأن الطبيب/ة شرح لي طبيعة جلسات ليزر إزالة الشعر (Laser Hair Removal) وعدد الجلسات المتوقع.",
      "أعلم أن الآثار الجانبية الشائعة تشمل الاحمرار والتورم المؤقت، ونادرًا: الحروق أو تغيّر لون الجلد.",
      "أقرّ بأنني أبلغت العيادة عن أي أدوية أتناولها، وعن الحمل، وعن التعرض للشمس خلال آخر 14 يومًا.",
      "أوافق على إجراء الجلسة وأتحمّل مسؤولية الالتزام بتعليمات العناية بعد الجلسة.",
    ].join("\n\n"),
    bodyEn: [
      DEMO_NOTICE_EN,
      "I confirm the practitioner explained Laser Hair Removal sessions and the expected number of sessions.",
      "I understand common side effects include temporary redness and swelling, and rarely burns or pigment change.",
      "I confirm I told the clinic about my medications, pregnancy, and sun exposure in the last 14 days.",
      "I consent to the session and will follow the aftercare instructions.",
    ].join("\n\n"),
  },
  {
    code: "injectables",
    rule: "every_visit",
    titleAr: "نموذج موافقة على حقن البوتوكس والفيلر",
    titleEn: "Consent for Botox and Filler injections",
    bodyAr: [
      DEMO_NOTICE_AR,
      "أقرّ بأن الطبيب/ة شرح لي إجراء الحقن (Botox / Fillers) والنتائج المتوقعة ومدة بقائها.",
      "أعلم بالمخاطر المحتملة: الكدمات، التورم، عدم التماثل المؤقت، ونادرًا: انسداد الأوعية الدموية.",
      "أقرّ بعدم وجود حمل أو رضاعة، وأنني أبلغت عن الحساسية من أي مادة، بما فيها الليدوكايين.",
      "أوافق على الإجراء وعلى التصوير الطبي قبل وبعد لأغراض الملف الطبي فقط.",
    ].join("\n\n"),
    bodyEn: [
      DEMO_NOTICE_EN,
      "I confirm the practitioner explained the injection procedure (Botox / Fillers), expected results and duration.",
      "I understand possible risks: bruising, swelling, temporary asymmetry, and rarely vascular occlusion.",
      "I confirm I am not pregnant or breastfeeding and have reported any allergies, including to lidocaine.",
      "I consent to the procedure and to before/after medical photos for my file only.",
    ].join("\n\n"),
  },
  {
    code: "chemical_peel",
    rule: "every_visit",
    titleAr: "نموذج موافقة على التقشير الكيميائي",
    titleEn: "Consent for Chemical Peeling",
    bodyAr: [
      DEMO_NOTICE_AR,
      "أقرّ بأن الطبيب/ة شرح لي التقشير الكيميائي ودرجة التقشير المناسبة لبشرتي.",
      "أعلم أن البشرة قد تحمرّ وتتقشر لعدة أيام، وأن التعرض للشمس بعد الجلسة قد يسبب تصبغات.",
      "أقرّ بأنني لا أستخدم الإيزوتريتينوين (روكتان) حاليًا أو خلال آخر 6 أشهر.",
      "أوافق على الإجراء وألتزم باستخدام واقي الشمس SPF 50 يوميًا.",
    ].join("\n\n"),
    bodyEn: [
      DEMO_NOTICE_EN,
      "I confirm the practitioner explained chemical peeling and the peel depth suitable for my skin.",
      "I understand my skin may be red and peel for several days, and sun exposure may cause pigmentation.",
      "I confirm I am not using isotretinoin (Roaccutane) now or in the last 6 months.",
      "I consent to the procedure and will use SPF 50 sunscreen daily.",
    ].join("\n\n"),
  },
  {
    code: "telehealth",
    rule: "months",
    months: 12,
    titleAr: "نموذج موافقة على الاستشارة المرئية (عن بُعد)",
    titleEn: "Consent for video (telehealth) consultations",
    bodyAr: [
      DEMO_NOTICE_AR,
      "أوافق على تلقي استشارة طبية عبر مكالمة فيديو بدلًا من الحضور إلى العيادة.",
      "أعلم أن الطبيب/ة لا يستطيع فحصي بالكامل عن بُعد، وقد يطلب زيارة العيادة لاستكمال الفحص أو العلاج.",
      "أعلم أن المكالمة لا تُسجَّل، وأن ما يُدوَّن منها يُحفظ في ملفي الطبي فقط، وأن الصور التي أرسلها تُحفظ في ملفي.",
      "أؤكد أنني في مكان خاص، وأن المعلومات التي أقدمها صحيحة. في الحالات الطارئة سأتصل بالرقم 997.",
    ].join("\n\n"),
    bodyEn: [
      DEMO_NOTICE_EN,
      "I agree to receive a medical consultation by video call instead of visiting the clinic.",
      "I understand the practitioner cannot fully examine me remotely and may ask me to visit the clinic to complete the examination or treatment.",
      "I understand the call is not recorded, notes from it are kept in my medical file only, and photos I send are kept in my file.",
      "I confirm I am in a private place and the information I give is accurate. In an emergency I will call 997.",
    ].join("\n\n"),
  },
];

export interface SeedPackageTemplate {
  key: string;
  serviceCode: string;
  nameAr: string;
  nameEn: string;
  sessions: number;
  priceSar: number;
  validityDays: number;
}

export const PACKAGE_TEMPLATES: Record<string, SeedPackageTemplate[]> = {
  derma: [
    {
      key: "lhr6",
      serviceCode: "laser_hair_removal",
      nameAr: "باقة ليزر إزالة الشعر — 6 جلسات",
      nameEn: "Laser Hair Removal — 6 sessions",
      sessions: 6,
      priceSar: 3600,
      validityDays: 365,
    },
    {
      key: "peel4",
      serviceCode: "chemical_peeling",
      nameAr: "باقة التقشير الكيميائي — 4 جلسات",
      nameEn: "Chemical Peeling — 4 sessions",
      sessions: 4,
      priceSar: 2000,
      validityDays: 180,
    },
    {
      key: "boost3",
      serviceCode: "skin_boosters",
      nameAr: "باقة محفزات البشرة — 3 جلسات",
      nameEn: "Skin Boosters — 3 sessions",
      sessions: 3,
      priceSar: 3900,
      validityDays: 180,
    },
    {
      key: "facial5",
      serviceCode: "facial_treatment",
      nameAr: "باقة تنظيف البشرة — 5 جلسات",
      nameEn: "Facial Treatment — 5 sessions",
      sessions: 5,
      priceSar: 1900,
      validityDays: 180,
    },
  ],
  lamsa: [
    {
      key: "facial5",
      serviceCode: "facial_treatment",
      nameAr: "باقة تنظيف البشرة — 5 جلسات",
      nameEn: "Facial Treatment — 5 sessions",
      sessions: 5,
      priceSar: 1800,
      validityDays: 180,
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2a demo data (online booking, patient page, push)
// ════════════════════════════════════════════════════════════════════════════

/** Doctors' gender, for the "female / male doctor" choice on the online booking page. */
export const STAFF_GENDER: Record<string, "male" | "female"> = {
  "derma-dr-sara": "female",
  "derma-dr-faisal": "male",
  "derma-dr-reem": "female",
  "derma-dr-lina": "female",
  "derma-dr-majed": "male",
  "lamsa-dr-mona": "female",
};

/** Online booking settings per clinic (defaults approved for Derma). */
export const ONLINE_SETTINGS: Record<
  string,
  { enabled: boolean; requiresApproval: boolean; showPrices: boolean }
> = {
  derma: { enabled: true, requiresApproval: false, showPrices: true },
  lamsa: { enabled: true, requiresApproval: true, showPrices: false },
};

/** Clinics whose WhatsApp chats are answered by the AI receptionist (when a key is set). */
export const AI_RECEPTIONIST: Record<string, boolean> = { derma: true, lamsa: false };

/**
 * Demo doctors' website profiles. The doctors are fictional demo staff, and so are these details;
 * the website labels the team as a demo team. Real clinics enter their own.
 */
const AR_EN = [
  { ar: "العربية", en: "Arabic" },
  { ar: "الإنجليزية", en: "English" },
];
export const STAFF_PROFILE: Record<string, Record<string, unknown>> = {
  "derma-dr-sara": {
    specialtyAr: "الأمراض الجلدية والتجميل",
    specialtyEn: "Medical & aesthetic dermatology",
    credentials: [
      { ar: "البورد السعودي في الأمراض الجلدية", en: "Saudi Board of Dermatology" },
      { ar: "زمالة الليزر والتجميل الجلدي", en: "Fellowship in laser & cosmetic dermatology" },
    ],
    languages: AR_EN,
  },
  "derma-dr-faisal": {
    specialtyAr: "الليزر واستعادة الشعر",
    specialtyEn: "Laser & hair restoration",
    credentials: [
      { ar: "البورد السعودي في الأمراض الجلدية", en: "Saudi Board of Dermatology" },
      { ar: "دبلوم زراعة الشعر", en: "Diploma in hair restoration" },
    ],
    languages: AR_EN,
  },
  "derma-dr-reem": {
    specialtyAr: "جلدية الأطفال والأمراض الجلدية",
    specialtyEn: "Pediatric & medical dermatology",
    credentials: [{ ar: "البورد العربي في الأمراض الجلدية", en: "Arab Board of Dermatology" }],
    languages: AR_EN,
  },
  "derma-dr-lina": {
    specialtyAr: "التجميل الجلدي والحقن",
    specialtyEn: "Aesthetic dermatology & injectables",
    credentials: [
      { ar: "البورد السعودي في الأمراض الجلدية", en: "Saudi Board of Dermatology" },
      { ar: "زمالة الطب التجميلي", en: "Fellowship in aesthetic medicine" },
    ],
    languages: AR_EN,
  },
  "derma-dr-majed": {
    specialtyAr: "حب الشباب والندبات والتصبغات",
    specialtyEn: "Acne, scars & pigmentation",
    credentials: [{ ar: "البورد السعودي في الأمراض الجلدية", en: "Saudi Board of Dermatology" }],
    languages: AR_EN,
  },
};

/**
 * Website texts (Settings → Website). Derma: wording, specialties, contacts and social links
 * taken from the clinic's own public website (dermaclinics.net) for the pitch demo. It lists no
 * doctors, accreditations, statistics or reviews, so none are added here.
 */
export const SITE_CONTENT: Record<string, Record<string, unknown>> = { derma: DERMA_SITE };

/** Clinics whose doctors can use the AI scribe (when a key is set). */
export const AI_SCRIBE: Record<string, boolean> = { derma: true, lamsa: false };

/** Services patients can book online (service codes). */
export const ONLINE_SERVICES: Record<string, string[]> = {
  derma: [
    "consultation",
    "laser_hair_removal",
    "botox",
    "fillers",
    "facial_treatment",
    "chemical_peeling",
    "video_consultation",
  ],
  lamsa: ["consultation", "facial_treatment"],
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2b demo data (WhatsApp)
// ════════════════════════════════════════════════════════════════════════════

/** The demo patient who sent STOP (no more reminders or follow-ups). */
export const WHATSAPP_OPTED_OUT = "D-0014";
