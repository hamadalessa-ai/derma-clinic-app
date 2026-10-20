/** Tricky mixed lines used by the PDF tests and the browser comparison test. */
export const TRICKY_LINES: { text: string; base: "rtl" | "ltr" }[] = [
  { text: "د. سارة – Laser Hair Removal – 1,250 ر.س – 2026/10/21", base: "rtl" },
  { text: "رقم الملف D-0001 · التاريخ 20 أكتوبر 2026 (الثلاثاء)", base: "rtl" },
  { text: "الجرعة: 20 وحدة Botox، ثم مراجعة بعد 14 يومًا.", base: "rtl" },
  { text: "السعر 1,250.50 ر.س. شامل الضريبة 15%؟", base: "rtl" },
  { text: "البريد admin@derma.demo والجوال 0500010001", base: "rtl" },
  { text: "قبل الساعة 10:30 صباحًا – Morpheus8 (RF) – 3/6 جلسات", base: "rtl" },
  { text: "التاريخ الهجري 1448/05/09 هـ والميلادي 2026/10/21 م", base: "rtl" },
  { text: "Patient: نورة القحطاني – file D-0001 – 1,250 SAR", base: "ltr" },
  { text: "«موافقة» على الإجراء [نسخة 2] — صياغة تجريبية!", base: "rtl" },
];
