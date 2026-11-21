/**
 * WhatsApp message types: default wording (Arabic + English), placeholders and buttons.
 * The clinic admin can switch each type on/off and edit the wording (message_templates).
 * Each type is also a Meta "utility" template (docs/WHATSAPP_TEMPLATES.md lists what to submit).
 *
 * Placeholders: {patient_first_name} {appointment} {service} {date} {time} {doctor} {branch}
 * {map_link} {my_link} {booking_link} {minutes} {instructions} {consent_note} {question} {code}
 * {care_link} {work}
 * {appointment} is "موعد بوتوكس" / "your Botox appointment" — or just "موعدك" / "your appointment"
 * when the clinic switches "show service name in WhatsApp messages" off.
 */

export const TEMPLATE_KINDS = [
  "booking_confirmation",
  "reminder",
  "running_late",
  "post_care",
  "no_show",
  "recall",
  "visit_instructions",
  "lab_ready",
  "verification_code",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Messages that only reply to the patient's own action (inside the 24-hour window). */
export const REPLY_KINDS = [
  "confirm_ack",
  "cancel_ack",
  "cancel_too_late",
  "change_too_late",
  "reschedule_offer",
  "reschedule_offer_other",
  "reschedule_none",
  "reschedule_unavailable",
  "reschedule_done",
  "reschedule_failed",
  "concern_ack",
  "all_good_ack",
  "stop_ack",
  "start_ack",
  "not_found",
  "photo_request",
  "staff_reply",
  "ai_reply",
] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

/** Verification codes and direct replies always go out; everything else needs opt-in. */
export const ESSENTIAL_KINDS: readonly string[] = ["verification_code", ...REPLY_KINDS];

export interface TemplateDefinition {
  kind: TemplateKind;
  metaName: string;
  /** Placeholders the wording may use, in Meta variable order. */
  variables: string[];
  bodyAr: string;
  bodyEn: string;
  /** Quick-reply buttons (action ids; titles come from BUTTON_TITLES). */
  buttons: ButtonAction[];
  /** Sent even when the admin hasn't changed anything; codes can't be switched off. */
  canDisable: boolean;
}

export type ButtonAction =
  "confirm" | "reschedule" | "cancel" | "all_good" | "concern" | "slot" | "my_page";

export const BUTTON_TITLES: Record<
  Exclude<ButtonAction, "slot" | "my_page">,
  { ar: string; en: string }
> = {
  confirm: { ar: "تأكيد", en: "Confirm" },
  reschedule: { ar: "تغيير الموعد", en: "Reschedule" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  all_good: { ar: "كل شيء جيد", en: "All good" },
  concern: { ar: "لدي استفسار/قلق", en: "I have a concern" },
};

export const TEMPLATES: Record<TemplateKind, TemplateDefinition> = {
  booking_confirmation: {
    kind: "booking_confirmation",
    metaName: "booking_confirmation",
    variables: [
      "patient_first_name",
      "appointment",
      "date",
      "time",
      "doctor",
      "branch",
      "map_link",
      "my_link",
    ],
    bodyAr:
      "مرحبًا {patient_first_name}، تم حجز {appointment} يوم {date} الساعة {time} مع {doctor} في {branch}.\nالموقع: {map_link}\nمواعيدك والموافقات: {my_link}",
    bodyEn:
      "Hello {patient_first_name}, {appointment} is booked for {date} at {time} with {doctor} at {branch}.\nLocation: {map_link}\nYour appointments and consents: {my_link}",
    buttons: [],
    canDisable: true,
  },
  reminder: {
    kind: "reminder",
    metaName: "appointment_reminder",
    variables: [
      "patient_first_name",
      "appointment",
      "date",
      "time",
      "doctor",
      "branch",
      "instructions",
      "consent_note",
    ],
    bodyAr:
      "مرحبًا {patient_first_name}، نذكّرك بـ{appointment} غدًا {date} الساعة {time} مع {doctor} في {branch}.\n{instructions}\n{consent_note}\nهل ستحضر؟",
    bodyEn:
      "Hello {patient_first_name}, a reminder of {appointment} tomorrow {date} at {time} with {doctor} at {branch}.\n{instructions}\n{consent_note}\nWill you come?",
    buttons: ["confirm", "reschedule", "cancel"],
    canDisable: true,
  },
  running_late: {
    kind: "running_late",
    metaName: "doctor_running_late",
    variables: ["patient_first_name", "doctor", "minutes", "time"],
    bodyAr:
      "مرحبًا {patient_first_name}، نعتذر: {doctor} متأخر اليوم حوالي {minutes} دقيقة. موعدك الساعة {time} قد يتأخر قليلًا. شكرًا لتفهّمك.",
    bodyEn:
      "Hello {patient_first_name}, we're sorry: {doctor} is running about {minutes} minutes late today. Your {time} appointment may start a little later. Thank you for your patience.",
    buttons: [],
    canDisable: true,
  },
  post_care: {
    kind: "post_care",
    metaName: "post_care_check_in",
    variables: ["patient_first_name", "question"],
    bodyAr: "مرحبًا {patient_first_name}، {question}",
    bodyEn: "Hello {patient_first_name}, {question}",
    buttons: ["all_good", "concern"],
    canDisable: true,
  },
  no_show: {
    kind: "no_show",
    metaName: "missed_appointment",
    variables: ["patient_first_name", "booking_link"],
    bodyAr:
      "مرحبًا {patient_first_name}، افتقدناك في موعدك اليوم. نتمنى أن تكون بخير. يمكنك حجز موعد جديد من هنا: {booking_link}",
    bodyEn:
      "Hello {patient_first_name}, we missed you at your appointment today. We hope you're well. You can book a new time here: {booking_link}",
    buttons: [],
    canDisable: true,
  },
  recall: {
    kind: "recall",
    metaName: "follow_up_recall",
    variables: ["patient_first_name", "appointment", "booking_link"],
    bodyAr:
      "مرحبًا {patient_first_name}، حان وقت {appointment} القادم. احجز بسهولة من هنا: {booking_link}",
    bodyEn:
      "Hello {patient_first_name}, it's time to book {appointment} again. Book easily here: {booking_link}",
    buttons: [],
    canDisable: true,
  },
  visit_instructions: {
    kind: "visit_instructions",
    metaName: "visit_instructions",
    variables: ["patient_first_name", "care_link"],
    bodyAr:
      "مرحبًا {patient_first_name}، شكرًا لزيارتك. تعليمات ما بعد الزيارة ومواعيدك القادمة هنا: {care_link}",
    bodyEn:
      "Hello {patient_first_name}, thank you for your visit. Your after-visit instructions and next appointments are here: {care_link}",
    buttons: [],
    canDisable: true,
  },
  lab_ready: {
    kind: "lab_ready",
    metaName: "lab_work_ready",
    variables: ["patient_first_name", "work", "booking_link"],
    bodyAr:
      "مرحبًا {patient_first_name}، وصل {work} الخاص بك من المعمل. احجز موعد التركيب من هنا: {booking_link} أو ردّ على هذه الرسالة.",
    bodyEn:
      "Hello {patient_first_name}, your {work} is back from the lab. Book your fitting here: {booking_link} or reply to this message.",
    buttons: [],
    canDisable: true,
  },
  verification_code: {
    kind: "verification_code",
    metaName: "verification_code",
    variables: ["code"],
    bodyAr: "رمز التحقق: {code} (صالح 10 دقائق). لا تشاركه مع أحد.",
    bodyEn: "Your verification code: {code} (valid 10 minutes). Don't share it with anyone.",
    buttons: [],
    canDisable: false,
  },
};

/** Fixed replies to the patient's own taps/messages (free-form, inside the 24-hour window). */
export const REPLIES: Record<
  Exclude<ReplyKind, "staff_reply" | "ai_reply">,
  { ar: string; en: string }
> = {
  confirm_ack: {
    ar: "شكرًا، تم تأكيد حضورك ✓ نراك في الموعد.",
    en: "Thank you, your attendance is confirmed ✓ See you then.",
  },
  cancel_ack: {
    ar: "تم إلغاء موعدك. يمكنك الحجز مجددًا في أي وقت: {booking_link}",
    en: "Your appointment is cancelled. You can book again any time: {booking_link}",
  },
  cancel_too_late: {
    ar: "لا يمكن الإلغاء عبر واتساب قبل أقل من {hours} ساعة من الموعد. فضلًا تواصل مع العيادة.",
    en: "It's less than {hours} hours before your visit, so it can't be cancelled on WhatsApp. Please contact the clinic.",
  },
  change_too_late: {
    ar: "لا يمكن تغيير الموعد عبر واتساب قبل أقل من {hours} ساعة منه. فضلًا تواصل مع العيادة.",
    en: "It's less than {hours} hours before your visit, so it can't be changed on WhatsApp. Please contact the clinic.",
  },
  reschedule_offer: {
    ar: "اختر وقتًا جديدًا مع نفس الطبيب، أو اختر يومًا آخر من صفحتك: {my_link}",
    en: "Choose a new time with the same doctor, or pick another day on your page: {my_link}",
  },
  reschedule_offer_other: {
    ar: "لا توجد أوقات متاحة قريبًا مع {doctor}. هذه أوقات متاحة مع أطباء آخرين (سيتغير الطبيب)، أو اختر من صفحتك: {my_link}",
    en: "{doctor} has no free times soon. Here are free times with other doctors (the doctor will change), or choose on your page: {my_link}",
  },
  reschedule_none: {
    ar: "لا توجد أوقات متاحة للحجز الإلكتروني خلال الفترة القادمة مع {doctor} أو غيره. فضلًا تواصل مع العيادة، أو راجع صفحتك لاحقًا: {my_link}",
    en: "There are no free online times in the coming period with {doctor} or other doctors. Please contact the clinic, or check your page later: {my_link}",
  },
  reschedule_unavailable: {
    ar: "لا يمكن تغيير هذا الموعد عبر واتساب. فضلًا تواصل مع العيادة. مواعيدك: {my_link}",
    en: "This appointment can't be changed on WhatsApp. Please contact the clinic. Your appointments: {my_link}",
  },
  reschedule_done: {
    ar: "تم تغيير موعدك إلى {date} الساعة {time} ✓",
    en: "Your appointment is moved to {date} at {time} ✓",
  },
  reschedule_failed: {
    ar: "عذرًا، لم يعد هذا الوقت متاحًا. اختر وقتًا آخر من صفحتك: {my_link}",
    en: "Sorry, that time is no longer free. Please choose another on your page: {my_link}",
  },
  concern_ack: {
    ar: "شكرًا لإخبارنا. ستتواصل معك العيادة قريبًا.",
    en: "Thank you for telling us. The clinic will contact you soon.",
  },
  all_good_ack: {
    ar: "يسعدنا ذلك! نتمنى لك دوام الصحة.",
    en: "Glad to hear it! Take care.",
  },
  stop_ack: {
    ar: "تم إيقاف رسائل التذكير والمتابعة. لإعادة تفعيلها أرسل «تفعيل».",
    en: "Reminders and follow-ups are switched off. Send START to switch them back on.",
  },
  start_ack: {
    ar: "تم تفعيل رسائل العيادة مجددًا ✓",
    en: "Clinic messages are switched back on ✓",
  },
  photo_request: {
    ar: "طلب من {doctor}: نرجو إرسال صورة واضحة للمنطقة المعالَجة في إضاءة جيدة، هنا في هذه المحادثة، للاطمئنان على حالتك.",
    en: "A request from {doctor}: please send a clear photo of the treated area in good light, here in this chat, so we can check on you.",
  },
  not_found: {
    ar: "لم نجد هذا الموعد أو لم يعد بالإمكان تغييره. فضلًا تواصل مع العيادة.",
    en: "We couldn't find this appointment or it can no longer be changed. Please contact the clinic.",
  },
};

/** Words that opt a person out / back in. */
export const STOP_WORDS = ["stop", "إيقاف", "ايقاف", "الغاء الاشتراك", "unsubscribe"];
export const START_WORDS = ["start", "تفعيل"];

/** Fills {placeholders}; unknown ones stay as they are. Lines left empty are removed. */
export function fill(text: string, vars: Record<string, string | null | undefined>): string {
  return text
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k] ?? "") : m))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** Placeholders used in a text that this type doesn't offer (shown as an error in the editor). */
export function unknownPlaceholders(kind: TemplateKind, text: string): string[] {
  const allowed = new Set(TEMPLATES[kind].variables);
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !allowed.has(v));
}

/** Demo wording for the main derma services (pre-visit, post-care, recall). */
export const SERVICE_TEXTS: Record<
  string,
  {
    preVisitAr?: string;
    preVisitEn?: string;
    postCareAr?: string;
    postCareEn?: string;
    recallAfterDays?: number;
  }
> = {
  video_consultation: {
    preVisitAr:
      "قبل المكالمة: اختر مكانًا هادئًا وجيد الإضاءة. يمكنك إرسال صور واضحة للمنطقة في هذه المحادثة قبل الموعد ليطّلع عليها الطبيب.",
    preVisitEn:
      "find a quiet, well-lit place. You can send clear photos of the area in this chat before the call, so the doctor can see them.",
  },
  laser_hair_removal: {
    preVisitAr: "قبل الجلسة: احلق المنطقة قبل يوم، وتجنّب الشمس والتقشير لمدة أسبوع.",
    preVisitEn:
      "Before the session: shave the area the day before, and avoid sun and exfoliation for a week.",
    postCareAr: "كيف حال بشرتك بعد جلسة الليزر؟",
    postCareEn: "How is your skin after the laser session?",
    recallAfterDays: 42,
  },
  botox: {
    preVisitAr: "قبل الجلسة: تجنّب الأسبرين والكحول ومميّعات الدم قبل 48 ساعة إن أمكن.",
    preVisitEn:
      "Before the session: avoid aspirin, alcohol and blood thinners for 48 hours if possible.",
    postCareAr: "كيف تشعر بعد جلسة البوتوكس؟ تذكّر ألا تستلقي 4 ساعات بعد الحقن.",
    postCareEn:
      "How do you feel after your Botox session? Remember not to lie down for 4 hours after the injection.",
    recallAfterDays: 120,
  },
  fillers: {
    preVisitAr: "قبل الجلسة: تجنّب مميّعات الدم قبل 48 ساعة، وأخبرنا إن كان لديك أي التهاب.",
    preVisitEn:
      "Before the session: avoid blood thinners for 48 hours, and tell us about any infection.",
    postCareAr: "كيف تشعر بعد حقن الفيلر؟ التورّم الخفيف طبيعي في الأيام الأولى.",
    postCareEn: "How do you feel after the filler? Mild swelling is normal in the first days.",
    recallAfterDays: 270,
  },
  chemical_peeling: {
    preVisitAr: "قبل الجلسة: أوقف الريتينول والمقشّرات قبل 5 أيام، وتجنّب الشمس.",
    preVisitEn: "Before the session: stop retinol and exfoliants 5 days before, and avoid the sun.",
    postCareAr: "كيف حال بشرتك بعد التقشير؟ استخدم واقي الشمس والمرطّب بانتظام.",
    postCareEn: "How is your skin after the peel? Use sunscreen and moisturiser regularly.",
    recallAfterDays: 30,
  },
  facial_treatment: {
    preVisitAr: "قبل الجلسة: تعال بوجه نظيف بدون مكياج إن أمكن.",
    preVisitEn: "Before the session: come with a clean face, no make-up if possible.",
    postCareAr: "كيف حال بشرتك بعد جلسة التنظيف؟",
    postCareEn: "How is your skin after the facial?",
    recallAfterDays: 30,
  },
  consultation: {
    preVisitAr: "أحضر قائمة بأي أدوية أو منتجات تستخدمها حاليًا.",
    preVisitEn: "Bring a list of any medicines or skin products you use now.",
  },
};
