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
} satisfies Record<string, ImageSlot>;

export type ImageSlotKey = keyof typeof SITE_IMAGE_SLOTS;
