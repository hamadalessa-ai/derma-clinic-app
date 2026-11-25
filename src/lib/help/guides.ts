/**
 * Help centre: short guides per role, in Arabic and English. Plain words, one action per step.
 * `link` points at the screen the step talks about (shown only if the reader may open it).
 * Keep in step with the screens: tab and button names here match messages/{ar,en}.json.
 */
import type { Permission } from "@/lib/auth/permissions";

export const HELP_ROLES = ["receptionist", "assistant", "practitioner", "clinic_admin"] as const;
export type HelpRole = (typeof HELP_ROLES)[number];

export interface HelpStep {
  ar: string;
  en: string;
}
export interface HelpGuide {
  id: string;
  titleAr: string;
  titleEn: string;
  steps: HelpStep[];
  link?: { href: string; permission: Permission };
}

const s = (ar: string, en: string): HelpStep => ({ ar, en });

export const HELP_GUIDES: Record<HelpRole, HelpGuide[]> = {
  receptionist: [
    {
      id: "day",
      titleAr: "بداية اليوم: لوحة سير المرضى",
      titleEn: "Start of the day: the patient flow board",
      link: { href: "/calendar?view=flow", permission: "calendar:view" },
      steps: [
        s(
          "افتح «اليوم» (أول صفحة). ترى كل مريض اليوم: متوقع، في الانتظار، مع الممرضة، مع الطبيب، المحاسبة، انتهت.",
          "Open Today (the first page). Every patient today is in a column: Expected, Waiting, With nurse, With doctor, Checkout, Done.",
        ),
        s(
          "البطاقة المحاطة بلون برتقالي تعني انتظاراً أكثر من 15 دقيقة أو تأخراً أكثر من 10 دقائق.",
          "A card outlined in amber means waiting 15+ minutes, or running 10+ minutes late.",
        ),
        s(
          "اضغط أي بطاقة لفتح الموعد: نقل، إلغاء، ملاحظة، اتصال أو واتساب.",
          "Tap any card to open the appointment: move, cancel, note, call or WhatsApp.",
        ),
      ],
    },
    {
      id: "find",
      titleAr: "البحث عن مريض بسرعة",
      titleEn: "Find a patient fast",
      link: { href: "/calendar", permission: "appointments:manage" },
      steps: [
        s(
          "اكتب في مربع البحث أعلى التقويم: الجوال (بأي شكل: ٠٥…، 05…، +966…)، أو الاسم، أو رقم الملف.",
          "Type in the search box above the calendar: the mobile (any form: 05…, Arabic digits, +966…), the name or the file number.",
        ),
        s(
          "إذا كان للمريض موعد اليوم يظهر وقته وحالته، وزر «تسجيل الحضور».",
          "If the patient has a visit today you see its time and status, and a Check in button.",
        ),
        s(
          "رقم غير مسجّل؟ اكتب الاسم واختر الجنس ثم «إضافة وحضور الآن».",
          "Unknown mobile? Type the name, pick the gender, then Add & walk-in.",
        ),
      ],
    },
    {
      id: "checkin",
      titleAr: "تسجيل الحضور والحضور بدون موعد",
      titleEn: "Check-in and walk-ins",
      steps: [
        s(
          "اضغط «تسجيل الحضور». إذا احتاجت الخدمة موافقة تفتح ورقة التوقيع أولاً: يوقّع المريض ثم يكتمل الحضور.",
          "Press Check in. If the service needs a consent, the signature sheet opens first: the patient signs, then check-in completes.",
        ),
        s(
          "إذا كان للمريض باقة تُخصم الجلسة تلقائياً ويظهر الرصيد المتبقي.",
          "If the patient has a package, the session is deducted automatically and the remaining balance is shown.",
        ),
        s(
          "حضور بدون موعد: «حضور بدون موعد» ← اختر الخدمة ← اضغط أقرب وقت متاح. يُحجز ويُسجّل الحضور معاً.",
          "Walk-in: Walk-in → choose the service → tap the first free time. It is booked and checked in together.",
        ),
      ],
    },
    {
      id: "selfcheckin",
      titleAr: "تسجيل الوصول الذاتي واستدعاء المريض",
      titleEn: "Self check-in and calling patients in",
      link: { href: "/calendar?view=flow", permission: "calendar:view" },
      steps: [
        s(
          "يوم الزيارة تصل المريض رسالة واتساب فيها زر «وصلت» (والزر أيضًا في صفحة المريض). عند وصوله يضغطه فيُسجَّل حضوره وحده، وتنتقل بطاقته إلى «في الانتظار» مع وسم «سجّل وصوله بنفسه».",
          'On the visit day the patient gets a WhatsApp message with an "I\'ve arrived" button (also on their patient page). Tapping it at the clinic checks them in; their card moves to Waiting with a "Self check-in" tag.',
        ),
        s(
          "إذا احتاج موافقة تصله أولاً رابط التوقيع، وبعد التوقيع يُسجَّل حضوره تلقائيًا.",
          "If a consent is needed they get its link first; signing it checks them in.",
        ),
        s(
          "عندما تجهز الغرفة اضغط «استدعاء» على بطاقته: تصله رسالة باسم الغرفة والطبيب. من لا يستخدم واتساب نناديه باسمه.",
          "When the room is ready, press Call in on their card: they get the room and the doctor on WhatsApp. Call out the name for anyone without WhatsApp.",
        ),
      ],
    },
    {
      id: "checkout",
      titleAr: "المحاسبة بعد الزيارة",
      titleEn: "Checkout after the visit",
      link: { href: "/calendar?view=flow", permission: "visits:checkout" },
      steps: [
        s(
          "عندما يرحّل الطبيب أو الممرضة الزيارة يصلك إشعار، وينتقل المريض إلى عمود «المحاسبة». اضغط «المحاسبة».",
          "When the doctor or nurse posts the visit you get a notification and the patient moves to Checkout. Press Checkout.",
        ),
        s(
          "ترى بنود الفاتورة والمبلغ المستحق (الجلسات المدفوعة بالباقة = صفر). أدخل المبلغ وطريقة الدفع ورقم الفاتورة من نظام العيادة، ثم «إتمام المحاسبة».",
          "You see the invoice lines and the amount due (package sessions = 0). Enter the amount, method and the invoice number from the clinic's system, then Complete checkout.",
        ),
        s(
          "احجز الجلسات القادمة من خطة العلاج بضغطة واحدة، ثم اطبع التعليمات أو أرسلها عبر واتساب.",
          "Book the next sessions from the treatment plan in one tap, then print the instructions or send them on WhatsApp.",
        ),
      ],
    },
    {
      id: "lab",
      titleAr: "أعمال معمل الأسنان",
      titleEn: "Dental lab cases",
      link: { href: "/lab-cases", permission: "lab:view" },
      steps: [
        s(
          "«أعمال المعمل» تعرض الأعمال لدى المعامل؛ المتأخر يظهر أولاً بلون مختلف.",
          "Lab cases lists work at the labs; overdue work comes first, highlighted.",
        ),
        s(
          "عند وصول العمل اضغط «تم الاستلام» ثم اتصل بالمريض أو راسله لحجز التركيب.",
          "When the work arrives press Received, then call or message the patient to book the fitting.",
        ),
      ],
    },
    {
      id: "memberships",
      titleAr: "العضويات",
      titleEn: "Memberships",
      link: { href: "/memberships", permission: "memberships:sell" },
      steps: [
        s(
          "من ملف المريض ← «الباقات» اختر الخطة في «بيع عضوية»، وسجّل المدفوع ورقم فاتورة العيادة.",
          "In the patient file → Packages, choose the plan under Sell a membership, then record what was paid and the clinic invoice number.",
        ),
        s(
          "عند تسجيل الوصول تُحتسب الزيارة المشمولة تلقائيًا، وعند الدفع يُخصم خصم الأعضاء من باقي البنود.",
          "At check-in an included visit is used automatically; at checkout the member discount comes off the other lines.",
        ),
        s(
          "صفحة «العضويات» تعرض من يحين تجديده. يصل العضوَ تذكير واتساب قبل 3 أيام؛ اضغط «تجديد» في ملفه.",
          "The Memberships page lists who is due for renewal. Members get a WhatsApp reminder 3 days before; press Renew in their file.",
        ),
      ],
    },
    {
      id: "inbox",
      titleAr: "رسائل واتساب",
      titleEn: "WhatsApp messages",
      link: { href: "/whatsapp", permission: "whatsapp:inbox" },
      steps: [
        s(
          "افتح «واتساب». المحادثات التي تحتاج رداً تظهر أولاً.",
          "Open WhatsApp. Chats that need a reply come first.",
        ),
        s(
          "موظف الاستقبال الذكي يجيب عن المواعيد والأسعار. أي سؤال طبي يُحوَّل إليكم مباشرة.",
          "The AI receptionist answers bookings and prices. Any medical question is handed to you straight away.",
        ),
        s(
          "عندما تردّون في محادثة يتوقف الذكاء الاصطناعي فيها حتى تعيدوه.",
          "Once you reply in a chat, the AI stays quiet there until you hand it back.",
        ),
      ],
    },
  ],

  assistant: [
    {
      id: "myday",
      titleAr: "يومي: مرضى أطبائك",
      titleEn: "My Day: your doctors' patients",
      link: { href: "/my-day", permission: "my_day:view" },
      steps: [
        s(
          "«يومي» يعرض مواعيد الأطباء الذين تعملين معهم (تحدّدهم الإدارة في إعدادات العيادة ← الفريق).",
          "My Day shows the appointments of the doctors you work with (the admin sets them in Clinic settings → Team).",
        ),
        s(
          "عندما يصل المريض (يسجّله الاستقبال أو يسجّل وصوله بنفسه) يظهر زرا «استدعاء» و«بدء الزيارة». «استدعاء» يرسل له اسم الغرفة على واتساب، ثم «بدء الزيارة» يفتح شاشة الزيارة.",
          "When the patient has arrived (checked in by reception or by themselves), Call in and Start visit appear. Call in sends them the room on WhatsApp; Start visit opens the visit screen.",
        ),
      ],
    },
    {
      id: "prepare",
      titleAr: "تجهيز الزيارة باسم الطبيب",
      titleEn: "Prepare the visit in the doctor's name",
      steps: [
        s(
          "اكتبي الملاحظة (أو استخدمي الإملاء الصوتي إن كان مفعّلاً). تُحفظ باسم الطبيب ويُكتب أنها أُدخلت بواسطتك.",
          "Write the note (or dictate, if the AI scribe is on). It is saved in the doctor's name, marked as entered by you.",
        ),
        s(
          "أضيفي الأدوية وخطة العلاج ورموز الفاتورة من قائمة الأسعار.",
          "Add medication, the treatment plan and invoice codes from the price list.",
        ),
        s(
          "عندما يكون المريض جاهزاً اضغطي «جاهز للطبيب»: يصل إشعار للطبيب ويرى الاستقبال «مع الطبيب».",
          "When the patient is ready press Ready for doctor: the doctor gets a notification and reception sees With doctor.",
        ),
      ],
    },
    {
      id: "post",
      titleAr: "ترحيل الزيارة",
      titleEn: "Post the visit",
      steps: [
        s(
          "بعد انتهاء الطبيب اضغطي «ترحيل الزيارة». تُحفظ الملاحظة والأوامر والرموز وتنتهي الزيارة.",
          "When the doctor is done press Post visit. The note, orders and codes are saved and the visit is completed.",
        ),
        s(
          "بعد الترحيل لا يمكن التعديل؛ التصحيح يضيفه الطبيب أسفل الملاحظة.",
          "After posting nothing can be changed; the doctor adds any correction underneath the note.",
        ),
        s(
          "لا ترين ملاحظات أطباء آخرين لا تعملين معهم.",
          "You never see the notes of doctors you don't work with.",
        ),
      ],
    },
  ],

  practitioner: [
    {
      id: "phone",
      titleAr: "يومي على الجوال",
      titleEn: "My Day on your phone",
      link: { href: "/my-day", permission: "my_day:view" },
      steps: [
        s(
          "افتح «يومي» على الجوال وأضفه إلى الشاشة الرئيسية من قائمة المتصفح.",
          "Open My Day on your phone and add it to the home screen from the browser menu.",
        ),
        s(
          "فعّل الإشعارات من «حسابي» (اضغط اسمك أعلى الصفحة): يصلك إشعار عند حضور المريض أو عندما تقول الممرضة إنه جاهز.",
          "Turn on notifications in My account (tap your name at the top): you are told when a patient arrives or the nurse says they are ready.",
        ),
      ],
    },
    {
      id: "visit",
      titleAr: "الزيارة: الملاحظة والأوامر والترحيل",
      titleEn: "The visit: note, orders, post",
      steps: [
        s(
          "اضغط «بدء الزيارة». اكتب الملاحظة أو أملِها: الذكاء الاصطناعي يكتب مسودة بالإنجليزية فقط، ولا يضيف تشخيصاً أو جرعات من عنده، ولا يوقّع أبداً. قبل النشر ضع علامة «راجعت مسودة الذكاء الاصطناعي».",
          'Press Start visit. Type or dictate the note: the AI only writes an English draft, adds no diagnosis or doses of its own, and never signs. Before posting, tick "I\'ve checked the AI draft".',
        ),
        s(
          "أضف الأدوية وخطة العلاج (عدد الجلسات وكل كم أسبوع) ورموز الفاتورة.",
          "Add medication, the treatment plan (sessions and weeks between them) and invoice codes.",
        ),
        s(
          "«ترحيل الزيارة» يحفظ كل شيء وينهي الزيارة في خطوة واحدة. خلال 7 أيام يمكنك «تصحيح الملاحظة» (يبقى النص السابق محفوظاً ويظهر تحت «النسخ السابقة»)؛ بعدها أضف ملحقاً أسفل الملاحظة.",
          "Post visit saves everything and completes the visit in one step. For 7 days you can use Correct note (the earlier text is kept under Earlier versions); after that, add an addendum underneath.",
        ),
      ],
    },
    {
      id: "dental",
      titleAr: "الأسنان: المخطط والخطة والمعمل",
      titleEn: "Dental: chart, plan and lab",
      steps: [
        s(
          "في زيارة الأسنان يظهر مخطط الأسنان: اضغط السن، اختر الحالة والأسطح، ثم «تسجيل». كل تغيير يُحفظ مع تاريخه.",
          "On a dental visit the tooth chart shows: tap a tooth, choose the condition and surfaces, then Record. Every change is kept with its date.",
        ),
        s(
          "أسرع: «إملاء» تحت المخطط، ثم قل «16 MO تسوس، 26 تاج، 36 مفقود» (أو اكتبها). راجع القائمة وأزل أي خطأ، ثم «حفظ في المخطط».",
          'Faster: Dictate under the chart and say "16 MO caries, 26 crown, 36 missing" (or type it). Check the list, untick any mistake, then Save to chart.',
        ),
        s(
          "خطة العلاج: أضف الإجراء لكل سن بسعره. «تم في هذه الزيارة» يضيفه لرموز فاتورة الزيارة.",
          "Treatment plan: add the procedure per tooth with its price. Done in this visit adds it to the visit's invoice codes.",
        ),
        s(
          "«إرسال للمعمل» للتاج أو الجسر وغيرهما مع موعد الاستلام؛ يتابعه الاستقبال في «أعمال المعمل».",
          "Send to lab for a crown, bridge and so on, with the due date; reception follows it in Lab cases.",
        ),
      ],
    },
    {
      id: "photos",
      titleAr: "صور قبل وبعد",
      titleEn: "Before & after photos",
      steps: [
        s(
          "في شاشة الزيارة: «التقاط صورة»، اختر المنطقة (مثل الخدّين) والزاوية، ثم «حفظ الصورة». تُربط الصورة بالزيارة.",
          "On the visit screen: Take photo, choose the area (e.g. Cheeks) and the angle, then Save photo. The photo is linked to the visit.",
        ),
        s(
          "ملف المريض ← «الصور»: الصور مرتبة حسب المنطقة والتاريخ. اضغط صورتين لنفس المنطقة لمقارنتهما جنبًا إلى جنب (قبل / بعد).",
          "Patient file → Photos: grouped by area and date. Tap two photos of the same area to compare them side by side (before / after).",
        ),
        s(
          "الصورة الخاطئة تُخفى مع ذكر السبب ولا تُحذف. يراها الأطباء والممرضات ومدير العيادة فقط، وكل فتح لها يُسجَّل.",
          "A wrong photo is hidden with a reason, never deleted. Only doctors, nurses and the clinic admin see photos, and every view is logged.",
        ),
      ],
    },
    {
      id: "labs",
      titleAr: "نتائج التحاليل",
      titleEn: "Lab results",
      steps: [
        s(
          "ملف المريض ← «التحاليل» (أو بطاقة التحاليل في شاشة الزيارة): «إضافة نتائج»، اكتب اسم التحليل والقيمة؛ الوحدة والمعدل الطبيعي يُملآن للتحاليل المعروفة، والمعدل المطبوع في تقرير المعمل هو الأصح.",
          "Patient file → Labs (or the Labs card on the visit screen): Add results, type the test and value; unit and range fill in for known tests, but the range printed on the lab's report is the one to use.",
        ),
        s(
          "أرفق تقرير المعمل (PDF أو صورة). القيم المنخفضة والمرتفعة تُعلَّم تلقائيًا. الخطأ يُلغى مع ذكر السبب ثم يُدخل من جديد.",
          "Attach the lab's report (PDF or photo). Low and high values are marked automatically. A mistake is voided with a reason, then entered again.",
        ),
        s(
          "«طلب إعادة تحليل» بموعد استحقاق؛ يظهر في الملف والزيارة حتى تُدخل نتيجته. النتائج للأطباء والممرضات فقط.",
          "Request repeat test with a due date; it shows on the file and visit until its result is entered. Results are for doctors and nurses only.",
        ),
      ],
    },
    {
      id: "video",
      titleAr: "الاستشارات بالفيديو",
      titleEn: "Video consultations",
      steps: [
        s(
          "زر «انضمام» يظهر في «يومي» قبل الموعد بقليل. المريض ينضم من رابط واتساب بعد توقيع موافقة الاستشارة عن بُعد.",
          "A Join button appears on My Day shortly before the visit. The patient joins from the WhatsApp link after signing the telehealth consent.",
        ),
        s("المكالمات لا تُسجَّل أبداً.", "Calls are never recorded."),
      ],
    },
    {
      id: "hours",
      titleAr: "ساعات العمل والإجازات",
      titleEn: "Working hours and days off",
      link: { href: "/working-hours", permission: "hours:edit" },
      steps: [
        s(
          "التقويم ← «ساعات العمل»: الجدول الأسبوعي، ويوم إجازة أو ساعات خاصة لتاريخ معين.",
          "Calendar → Working hours: the weekly pattern, plus a day off or special hours on a date.",
        ),
        s(
          "تغيير الساعات لا ينقل ولا يلغي أي حجز؛ تظهر لك المواعيد المتعارضة لتتصرف فيها.",
          "Changing hours never moves or cancels a booking; you are shown the clashing appointments to handle.",
        ),
      ],
    },
  ],

  clinic_admin: [
    {
      id: "setup",
      titleAr: "إعدادات العيادة",
      titleEn: "Clinic settings",
      link: { href: "/setup", permission: "setup:manage" },
      steps: [
        s(
          "«إعدادات العيادة»: الفروع، الأقسام، الخدمات (السعر، المدة، الجهاز، الموافقة، الحجز أونلاين)، الغرف والأجهزة، الباقات، نماذج الموافقة.",
          "Clinic settings: branches, departments, services (price, duration, device, consent, online booking), rooms and devices, packages, consent forms.",
        ),
        s(
          "«قائمة الأسعار»: المنتجات والمستهلكات والإجراءات برموزها، يضيفها الطبيب للزيارة. السعر يُنسخ إلى الزيارة فلا يتغير الماضي.",
          "Price list: products, consumables and procedures with their codes, added to visits by the doctor. The price is copied onto the visit, so the past never changes.",
        ),
      ],
    },
    {
      id: "team",
      titleAr: "الفريق والأدوار",
      titleEn: "Team and roles",
      link: { href: "/settings?tab=team", permission: "team:manage" },
      steps: [
        s(
          "إعدادات العيادة ← الفريق: أضف موظفاً فيصله رابط دعوة، واختر دوره وفرعه.",
          "Clinic settings → Team: add a staff member (they get an invitation link) and choose their role and branch.",
        ),
        s(
          "للممرضة: اختر الأطباء الذين تعمل معهم، فترى أيامهم وتجهّز زياراتهم.",
          "For a nurse: choose the doctors she works with, so she sees their days and prepares their visits.",
        ),
        s(
          "دعم المنصة لا يرى بيانات المرضى إلا بإذن مؤقت منك (من نفس الصفحة)، وكل ما يفعله مسجّل.",
          "Platform support sees no patient data unless you grant time-limited access (same page); everything they do is logged.",
        ),
      ],
    },
    {
      id: "reports",
      titleAr: "التقارير وملف الفوترة اليومي",
      titleEn: "Reports and the daily invoicing file",
      link: { href: "/reports", permission: "reports:view" },
      steps: [
        s(
          "«التقارير»: الحجوزات، المكتملة، نسبة عدم الحضور، الحجز أونلاين، الباقات، المرضى الجدد، مقارنة بالشهر السابق.",
          "Reports: bookings, completed visits, no-show rate, online share, packages, new patients, compared with last month.",
        ),
        s(
          "ملف اليوم: بنود كل زيارة، وما دُفع عند المحاسبة ورقم فاتورتكم، والباقات — لاستيراده في نظام المحاسبة أو زاتكا.",
          "The day's file: each visit's lines, what was paid at checkout with your invoice number, and packages — to import into your accounting or ZATCA system.",
        ),
      ],
    },
    {
      id: "whatsapp",
      titleAr: "واتساب والذكاء الاصطناعي",
      titleEn: "WhatsApp and AI",
      link: { href: "/settings/whatsapp", permission: "settings:manage" },
      steps: [
        s(
          "اختر الرسائل التلقائية: التأكيد، التذكير، تعليمات قبل الزيارة، المتابعة بعدها، عدم الحضور، الاستدعاء. لا تُرسل رسائل بين 10 مساءً و8 صباحاً.",
          "Choose the automatic messages: confirmation, reminder, pre-visit, after-care, no-show, recall. Nothing is sent between 10 pm and 8 am.",
        ),
        s(
          "من نفس الصفحة شغّل أو أوقف موظف الاستقبال الذكي. الإملاء الصوتي للأطباء من إعدادات العيادة ← بيانات العيادة.",
          "On the same page switch the AI receptionist on or off. The doctors' AI scribe is in Clinic settings → Clinic details.",
        ),
      ],
    },
    {
      id: "security",
      titleAr: "الأمان",
      titleEn: "Security",
      link: { href: "/account", permission: "account:manage" },
      steps: [
        s(
          "فعّل التحقق بخطوتين من «حسابي» تحت اسمك أعلى الصفحة (تطبيق المصادقة + رموز احتياطية).",
          "Turn on two-step verification in My account, under your name at the top (authenticator app + backup codes).",
        ),
        s(
          "تنزيل بيانات العيادة من إعدادات العيادة ← بيانات العيادة (بدون ملاحظات سريرية)، وكل تنزيل مسجّل.",
          "Download clinic data from Clinic settings → Clinic details (no clinical notes); every download is logged.",
        ),
      ],
    },
  ],
};

/** Which guide set opens first for these roles (the first role that has guides). */
export function helpRoleFor(roles: readonly string[]): HelpRole {
  return (HELP_ROLES.find((r) => roles.includes(r)) ?? "receptionist") as HelpRole;
}
