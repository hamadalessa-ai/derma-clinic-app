/**
 * Every photo slot on the clinic website: where it appears, what it must show (alt text in both
 * languages) and the file it expects. A clinic's real photos are set per slot in
 * `tenant_settings.site.images` (slot → URL, e.g. "/site/derma/hero.jpg" in /public or a
 * file-store URL). Until then the website shows a labelled frame naming the slot and the file.
 */
export interface ImageSlot {
  /** Suggested file name (in /public/site/<clinic>/). */
  file: string;
  /** Recommended size (pixels) and crop. */
  size: string;
  altAr: string;
  altEn: string;
}

export const SITE_IMAGE_SLOTS = {
  hero: {
    file: "hero.jpg",
    size: "1600×1200, landscape",
    altAr: "استقبال عيادات ديرما في الرياض",
    altEn: "Derma Clinics reception and waiting area in Riyadh",
  },
  "dept-skin": {
    file: "dept-skin-aesthetics-hair.jpg",
    size: "1200×900",
    altAr: "طبيبة جلدية تفحص بشرة مريضة في عيادات ديرما",
    altEn: "Dermatologist examining a patient's skin at Derma Clinics",
  },
  "dept-dental": {
    file: "dept-dental-care.jpg",
    size: "1200×900",
    altAr: "عيادة طب الأسنان في عيادات ديرما",
    altEn: "Dental treatment room at Derma Clinics",
  },
  "dept-plastic": {
    file: "dept-plastic-surgery.jpg",
    size: "1200×900",
    altAr: "استشارة جراحة التجميل في عيادات ديرما",
    altEn: "Plastic surgery consultation at Derma Clinics",
  },
  about: {
    file: "about-clinic.jpg",
    size: "1200×1500, portrait",
    altAr: "فريق عيادات ديرما الطبي في العيادة",
    altEn: "Derma Clinics medical team at the clinic",
  },
  "clinic-1": {
    file: "clinic-1-reception.jpg",
    size: "1200×900",
    altAr: "منطقة الاستقبال في عيادات ديرما",
    altEn: "Derma Clinics reception area",
  },
  "clinic-2": {
    file: "clinic-2-treatment-room.jpg",
    size: "1200×900",
    altAr: "غرفة علاج مجهزة في عيادات ديرما",
    altEn: "Equipped treatment room at Derma Clinics",
  },
  "clinic-3": {
    file: "clinic-3-laser-suite.jpg",
    size: "1200×900",
    altAr: "جناح الليزر وأجهزته في عيادات ديرما",
    altEn: "Laser suite and devices at Derma Clinics",
  },
  "clinic-4": {
    file: "clinic-4-waiting-lounge.jpg",
    size: "1200×900",
    altAr: "صالة الانتظار في عيادات ديرما",
    altEn: "Patient waiting lounge at Derma Clinics",
  },
  "service-skin": {
    file: "service-dermatology-aesthetic.jpg",
    size: "1200×800",
    altAr: "جلسة علاج بالليزر للبشرة في عيادات ديرما",
    altEn: "Laser skin treatment session at Derma Clinics",
  },
  "service-hair": {
    file: "service-hair-restoration.jpg",
    size: "1200×800",
    altAr: "استشارة زراعة الشعر وفحص فروة الرأس",
    altEn: "Hair transplant consultation and scalp examination",
  },
  "service-plastic": {
    file: "service-plastic-surgery.jpg",
    size: "1200×800",
    altAr: "جرّاح تجميل يشرح خطة العلاج لمريض",
    altEn: "Plastic surgeon explaining a treatment plan to a patient",
  },
  "service-dental": {
    file: "service-dental.jpg",
    size: "1200×800",
    altAr: "طبيب أسنان يعالج مريضًا في عيادة الأسنان",
    altEn: "Dentist treating a patient in the dental clinic",
  },
  video: {
    file: "video-consultation.jpg",
    size: "1200×900",
    altAr: "مريضة في استشارة فيديو مع طبيبة ديرما عبر الجوال",
    altEn: "Patient in a video consultation with a Derma Clinics doctor on a phone",
  },
} satisfies Record<string, ImageSlot>;

/** A doctor's portrait slot (one per doctor; set by the doctor's member id). */
export function doctorImageSlot(id: string, nameAr: string, nameEn: string): ImageSlot {
  return {
    file: `doctor-${id.slice(0, 8)}.jpg`,
    size: "900×1200, portrait",
    altAr: `صورة ${nameAr}`,
    altEn: `Portrait of ${nameEn}`,
  };
}

export type ImageSlotKey = keyof typeof SITE_IMAGE_SLOTS;
