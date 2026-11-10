/**
 * Ready starts for a new clinic: departments, common services (sample durations and prices the
 * clinic then edits in Clinic set-up), consent forms (sample wording, to be reviewed by the
 * clinic's legal adviser), consent rules, packages and rooms. Nothing here is patient data.
 */
import { CONSENT_TEMPLATES } from "@/db/seed-data";

export const SPECIALTIES = ["dermatology", "dental", "both", "blank"] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export interface TemplateService {
  code: string;
  nameAr: string;
  nameEn: string;
  minutes: number;
  buffer: number;
  priceSar: number;
  consent?: string;
  device?: string;
  online?: boolean;
  virtual?: boolean;
  recallDays?: number;
  preVisitAr?: string;
  preVisitEn?: string;
  postCareAr?: string;
  postCareEn?: string;
}

export interface TemplateDepartment {
  code: string;
  nameAr: string;
  nameEn: string;
  services: TemplateService[];
}

export interface TemplateConsent {
  code: string;
  rule: "every_visit" | "per_package" | "months";
  months?: number;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}

export interface TemplatePackage {
  service: string;
  nameAr: string;
  nameEn: string;
  sessions: number;
  priceSar: number;
  validityDays: number;
}

export interface ClinicTemplate {
  departments: TemplateDepartment[];
  consents: TemplateConsent[];
  packages: TemplatePackage[];
  /** Rooms of the first branch (besides the video room when a video service exists). */
  rooms: { nameAr: string; nameEn: string }[];
}

const SAMPLE_AR = "نص نموذجي: يُرجى مراجعته مع المستشار القانوني للعيادة قبل استخدامه.";
const SAMPLE_EN = "Sample wording: please have it reviewed by the clinic's legal adviser before use.";

/** The demo's dermatology forms, with the demo notice replaced by a "sample wording" note. */
const fromSeed = (code: string): TemplateConsent => {
  const c = CONSENT_TEMPLATES.find((x) => x.code === code);
  if (!c) throw new Error(`no seed consent ${code}`);
  const swap = (body: string, note: string) => [note, ...body.split("\n\n").slice(1)].join("\n\n");
  return {
    code: c.code,
    rule: c.rule,
    months: c.months,
    titleAr: c.titleAr,
    titleEn: c.titleEn,
    bodyAr: swap(c.bodyAr, SAMPLE_AR),
    bodyEn: swap(c.bodyEn, SAMPLE_EN),
  };
};

const VIDEO: TemplateService = {
  code: "video_consultation",
  nameAr: "استشارة مرئية (فيديو)",
  nameEn: "Video Consultation",
  minutes: 20,
  buffer: 10,
  priceSar: 250,
  consent: "telehealth",
  online: true,
  virtual: true,
};

const DERMATOLOGY: TemplateDepartment = {
  code: "dermatology",
  nameAr: "الجلدية والتجميل",
  nameEn: "Dermatology & Aesthetics",
  services: [
    { code: "consultation", nameAr: "استشارة جلدية", nameEn: "Dermatology Consultation", minutes: 20, buffer: 10, priceSar: 300, online: true },
    { code: "follow_up", nameAr: "مراجعة", nameEn: "Follow-up Visit", minutes: 15, buffer: 5, priceSar: 150, online: true },
    { code: "botox", nameAr: "بوتوكس", nameEn: "Botox", minutes: 30, buffer: 10, priceSar: 1200, consent: "injectables", online: true, recallDays: 120 },
    { code: "fillers", nameAr: "فيلر", nameEn: "Fillers", minutes: 45, buffer: 15, priceSar: 1800, consent: "injectables", recallDays: 270 },
    { code: "chemical_peeling", nameAr: "التقشير الكيميائي", nameEn: "Chemical Peeling", minutes: 45, buffer: 15, priceSar: 600, consent: "chemical_peel", recallDays: 30 },
    { code: "facial_treatment", nameAr: "جلسة تنظيف البشرة", nameEn: "Facial Treatment", minutes: 60, buffer: 15, priceSar: 450, online: true, recallDays: 30 },
    { code: "prp", nameAr: "البلازما (PRP)", nameEn: "PRP", minutes: 45, buffer: 15, priceSar: 900, recallDays: 30 },
    VIDEO,
  ],
};

const LASER: TemplateDepartment = {
  code: "laser",
  nameAr: "الليزر",
  nameEn: "Laser",
  services: [
    {
      code: "laser_hair_removal",
      nameAr: "ليزر إزالة الشعر",
      nameEn: "Laser Hair Removal",
      minutes: 60,
      buffer: 15,
      priceSar: 800,
      consent: "laser_hair_removal",
      online: true,
      recallDays: 42,
      preVisitAr: "قبل الجلسة: احلقي المنطقة قبل يوم، وتجنّبي الشمس والتقشير لمدة أسبوع.",
      preVisitEn: "Before the session: shave the area the day before; avoid sun and peeling for a week.",
      postCareAr: "بعد الجلسة: واقي شمس، وتجنّب الحرارة والرياضة الشديدة ليومين.",
      postCareEn: "After the session: sunscreen; avoid heat and intense exercise for two days.",
    },
    { code: "fractional_laser", nameAr: "الليزر التجزيئي", nameEn: "Fractional Laser", minutes: 60, buffer: 15, priceSar: 1500, recallDays: 30 },
    { code: "laser_pigmentation", nameAr: "ليزر التصبغات", nameEn: "Laser Pigmentation Removal", minutes: 45, buffer: 15, priceSar: 1000, recallDays: 30 },
  ],
};

const DENTAL: TemplateDepartment = {
  code: "dental",
  nameAr: "طب الأسنان",
  nameEn: "Dental",
  services: [
    { code: "dental_consultation", nameAr: "كشف أسنان", nameEn: "Dental Check-up", minutes: 20, buffer: 10, priceSar: 150, online: true, recallDays: 180 },
    { code: "scaling_polishing", nameAr: "تنظيف وتلميع الأسنان", nameEn: "Scaling & Polishing", minutes: 45, buffer: 15, priceSar: 350, consent: "dental_treatment", online: true, recallDays: 180 },
    { code: "dental_filling", nameAr: "حشوة تجميلية", nameEn: "Composite Filling", minutes: 45, buffer: 15, priceSar: 450, consent: "dental_treatment" },
    { code: "root_canal", nameAr: "علاج عصب", nameEn: "Root Canal Treatment", minutes: 90, buffer: 15, priceSar: 1500, consent: "dental_treatment" },
    { code: "extraction", nameAr: "خلع سن", nameEn: "Tooth Extraction", minutes: 30, buffer: 15, priceSar: 400, consent: "dental_treatment" },
    { code: "teeth_whitening", nameAr: "تبييض الأسنان", nameEn: "Teeth Whitening", minutes: 60, buffer: 15, priceSar: 1500, consent: "teeth_whitening", online: true },
    { code: "ortho_consultation", nameAr: "استشارة تقويم", nameEn: "Orthodontic Consultation", minutes: 30, buffer: 10, priceSar: 200, online: true },
  ],
};

const DENTAL_CONSENTS: TemplateConsent[] = [
  {
    code: "dental_treatment",
    rule: "every_visit",
    titleAr: "نموذج موافقة على علاج الأسنان",
    titleEn: "Consent for dental treatment",
    bodyAr: [
      SAMPLE_AR,
      "أقرّ بأن طبيب/ة الأسنان شرح لي العلاج المقترح وبدائله والتكلفة التقريبية وعدد الزيارات المتوقع.",
      "أعلم أن الآثار المحتملة تشمل الألم المؤقت والتورم والحساسية، ونادرًا: العدوى أو الحاجة إلى علاج إضافي.",
      "أقرّ بأنني أبلغت العيادة عن حالتي الصحية والأدوية التي أتناولها والحساسية من أي دواء أو مخدر موضعي، وعن الحمل.",
      "أوافق على إجراء العلاج وألتزم بتعليمات ما بعد العلاج.",
    ].join("\n\n"),
    bodyEn: [
      SAMPLE_EN,
      "I confirm the dentist explained the proposed treatment, alternatives, approximate cost and expected number of visits.",
      "I understand possible effects include temporary pain, swelling and sensitivity, and rarely infection or the need for further treatment.",
      "I confirm I told the clinic about my health, my medications, any allergy to medicines or local anaesthetic, and pregnancy.",
      "I consent to the treatment and will follow the aftercare instructions.",
    ].join("\n\n"),
  },
  {
    code: "teeth_whitening",
    rule: "per_package",
    titleAr: "نموذج موافقة على تبييض الأسنان",
    titleEn: "Consent for teeth whitening",
    bodyAr: [
      SAMPLE_AR,
      "أعلم أن نتيجة التبييض تختلف من شخص لآخر ولا تغيّر لون الحشوات أو التركيبات.",
      "أعلم أن حساسية الأسنان وتهيّج اللثة مؤقتًا من الآثار الشائعة.",
      "أوافق على إجراء التبييض وألتزم بتعليمات الأكل والشرب بعده.",
    ].join("\n\n"),
    bodyEn: [
      SAMPLE_EN,
      "I understand whitening results differ between people and do not change the colour of fillings or crowns.",
      "I understand temporary tooth sensitivity and gum irritation are common.",
      "I consent to the whitening and will follow the food and drink instructions afterwards.",
    ].join("\n\n"),
  },
];

const DERM_CONSENTS = ["laser_hair_removal", "injectables", "chemical_peel"].map(fromSeed);
const TELEHEALTH = fromSeed("telehealth");

const DERM_PACKAGES: TemplatePackage[] = [
  { service: "laser_hair_removal", nameAr: "باقة ليزر إزالة الشعر — 6 جلسات", nameEn: "Laser Hair Removal — 6 sessions", sessions: 6, priceSar: 3600, validityDays: 365 },
  { service: "chemical_peeling", nameAr: "باقة التقشير الكيميائي — 4 جلسات", nameEn: "Chemical Peeling — 4 sessions", sessions: 4, priceSar: 2000, validityDays: 180 },
];
const DENTAL_PACKAGES: TemplatePackage[] = [
  { service: "scaling_polishing", nameAr: "باقة تنظيف الأسنان — جلستان في السنة", nameEn: "Scaling & Polishing — 2 visits a year", sessions: 2, priceSar: 600, validityDays: 365 },
];

export function clinicTemplate(s: Specialty): ClinicTemplate {
  if (s === "dermatology")
    return {
      departments: [DERMATOLOGY, LASER],
      consents: [...DERM_CONSENTS, TELEHEALTH],
      packages: DERM_PACKAGES,
      rooms: [
        { nameAr: "غرفة الكشف 1", nameEn: "Consultation Room 1" },
        { nameAr: "غرفة الليزر 1", nameEn: "Laser Room 1" },
      ],
    };
  if (s === "dental")
    return {
      departments: [{ ...DENTAL, services: [...DENTAL.services, VIDEO] }],
      consents: [...DENTAL_CONSENTS, TELEHEALTH],
      packages: DENTAL_PACKAGES,
      rooms: [
        { nameAr: "كرسي الأسنان 1", nameEn: "Dental Chair 1" },
        { nameAr: "كرسي الأسنان 2", nameEn: "Dental Chair 2" },
      ],
    };
  if (s === "both")
    return {
      departments: [DERMATOLOGY, LASER, DENTAL],
      consents: [...DERM_CONSENTS, ...DENTAL_CONSENTS, TELEHEALTH],
      packages: [...DERM_PACKAGES, ...DENTAL_PACKAGES],
      rooms: [
        { nameAr: "غرفة الكشف 1", nameEn: "Consultation Room 1" },
        { nameAr: "غرفة الليزر 1", nameEn: "Laser Room 1" },
        { nameAr: "كرسي الأسنان 1", nameEn: "Dental Chair 1" },
      ],
    };
  return { departments: [], consents: [], packages: [], rooms: [{ nameAr: "غرفة الكشف 1", nameEn: "Consultation Room 1" }] };
}
