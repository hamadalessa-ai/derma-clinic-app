/**
 * Demo seed data — ALL FAKE. Names, phone numbers and dates of birth are invented.
 * Prices and durations are rough demo estimates, not real clinic prices.
 *
 * IDs are deterministic (derived from a readable key) so db/setup.sql is reproducible
 * and tests can refer to known records.
 */
import { createHash } from "node:crypto";

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
}

export interface SeedPatient {
  fileNumber: string;
  fullNameAr: string;
  fullNameEn: string;
  phone: string;
  gender: "male" | "female";
  dateOfBirth: string;
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
];

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
    return {
      fileNumber: `${filePrefix}-${String(i + 1).padStart(4, "0")}`,
      fullNameAr: `${firstAr} ${fatherAr} ${familyAr}`,
      fullNameEn: `${firstEn} ${fatherEn} ${familyEn}`,
      phone: `0500${phonePrefix}${String(i + 1).padStart(4, "0")}`,
      gender: isFemale ? "female" : "male",
      dateOfBirth: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  });
}

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
  brandColor: "#28817a",
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
  patients: makeFakePatients(40, "D", "01"),
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
  devices: [],
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

export const SEED_TENANTS = [DERMA, LAMSA];

/** Working hours for practitioners and receptionists: Sunday–Thursday 10:00–19:00. */
export const WORK_WEEK = [0, 1, 2, 3, 4];
export const WORK_HOURS = { start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" };

/** Clinic setting: do doctors move their own appointments (true) or send requests (false)? */
export const DOCTORS_MANAGE_OWN_SCHEDULE: Record<string, boolean> = { derma: false, lamsa: true };

/** Clinic-wide closed days (demo). */
export const HOLIDAYS = [
  { day: "2026-09-23", nameAr: "اليوم الوطني السعودي", nameEn: "Saudi National Day" },
  { day: "2027-02-22", nameAr: "يوم التأسيس", nameEn: "Founding Day" },
];
