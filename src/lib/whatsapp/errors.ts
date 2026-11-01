/**
 * WhatsApp (Meta Cloud API) error codes in plain words, for the status page and the inbox.
 * Source: Meta's "Cloud API error codes" reference.
 */
export const WHATSAPP_ERRORS: Record<string, { ar: string; en: string }> = {
  "131031": {
    ar: "الحساب مقيّد: تطلب Meta توثيق النشاط التجاري (السجل التجاري) قبل الإرسال.",
    en: "Account locked: Meta requires business verification (Commercial Registration) before sending.",
  },
  "131047": {
    ar: "مرّت أكثر من 24 ساعة منذ آخر رسالة من المريض: يمكن إرسال قالب معتمد فقط.",
    en: "More than 24 hours since the patient's last message: only an approved template can be sent.",
  },
  "131026": {
    ar: "تعذّر التسليم: الرقم غير مسجّل في واتساب أو لا يمكنه استلام الرسالة.",
    en: "Not delivered: the number isn't on WhatsApp or can't receive this message.",
  },
  "131049": {
    ar: "لم تسلّم Meta الرسالة للحفاظ على تجربة المستخدم (حدّ الرسائل التسويقية).",
    en: "Meta didn't deliver it to protect the user experience (marketing message limits).",
  },
  "131056": {
    ar: "رسائل كثيرة لنفس الرقم في وقت قصير. حاول لاحقًا.",
    en: "Too many messages to the same number in a short time. Try again later.",
  },
  "130429": {
    ar: "تم تجاوز حدّ الإرسال لدى Meta. حاول لاحقًا.",
    en: "Meta's sending rate limit was reached. Try again later.",
  },
  "132000": {
    ar: "عدد المتغيّرات لا يطابق القالب المعتمد لدى Meta.",
    en: "The number of variables doesn't match the approved template at Meta.",
  },
  "132001": {
    ar: "القالب غير موجود أو غير معتمد بهذه اللغة لدى Meta.",
    en: "The template doesn't exist or isn't approved in this language at Meta.",
  },
  "132015": {
    ar: "القالب موقوف مؤقتًا لدى Meta (جودة منخفضة).",
    en: "The template is paused at Meta (low quality).",
  },
  "131051": {
    ar: "نوع رسالة غير مدعوم.",
    en: "Unsupported message type.",
  },
  "190": {
    ar: "رمز الوصول (Access token) منتهي أو غير صالح. أنشئ رمزًا دائمًا لمستخدم النظام وضعه في Vercel.",
    en: "The access token expired or is invalid. Create a permanent system-user token and put it in Vercel.",
  },
  "100": {
    ar: "إعداد غير صحيح في الطلب (مثلًا رقم الهاتف أو معرّف الرقم).",
    en: "A setting in the request is wrong (e.g. phone number or phone number ID).",
  },
  "368": {
    ar: "الحساب محظور مؤقتًا بسبب مخالفة سياسات Meta.",
    en: "The account is temporarily blocked for a Meta policy violation.",
  },
  outside_window: {
    ar: "خارج نافذة الـ24 ساعة: لا يمكن إرسال رد حر، فقط القوالب المعتمدة.",
    en: "Outside the 24-hour window: free replies can't be sent, only approved templates.",
  },
  network: {
    ar: "تعذّر الاتصال بخدمة واتساب.",
    en: "Couldn't reach the WhatsApp service.",
  },
};

export function explainError(code: string | null | undefined, lang: "ar" | "en" = "ar") {
  if (!code) return null;
  return WHATSAPP_ERRORS[code]?.[lang] ?? null;
}
