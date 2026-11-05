/**
 * Website content for the Derma Clinics pitch demo, taken from the clinic's own public website
 * (dermaclinics.net, English and Arabic pages, November 2026): wording, departments, every
 * procedure, the medical team (names, titles and photos as published there), partner logos and
 * photos. Images are served from their site's image CDN. Treatments are grouped into categories
 * (laser, injectables, …) for browsing; the procedure names themselves are theirs, unchanged.
 */
const I = (ar: string, en: string) => ({ ar, en });
const TENANT = "https://cdn.rekaz.io/tenants/3a210100-f494-af5e-f3a8-2769280512c2/";
export const DERMA_IMG = (file: string, width = 1200) =>
  `https://img.rekaz.io/cdn-cgi/image/quality=85,fit=scale-down,width=${width},f=auto/${TENANT}${file}`;

type Doc = {
  nameAr: string;
  nameEn: string;
  titleAr: string;
  titleEn: string;
  dept: "skin" | "hair" | "dental" | "plastic";
  branchAr?: string;
  branchEn?: string;
  photo: string;
  founder?: boolean;
  bioAr?: string;
  bioEn?: string;
};
const doc = (
  file: string,
  nameAr: string,
  nameEn: string,
  titleAr: string,
  titleEn: string,
  dept: Doc["dept"],
  extra: Partial<Doc> = {},
): Doc => ({ nameAr, nameEn, titleAr, titleEn, dept, photo: DERMA_IMG(file, 900), ...extra });

const DERM_LASER = I("استشاري طب الجلد والعلاج بالليزر", "Consultant in Dermatology and Laser Medicine");
const DERM_AES = I("أمراض الجلدية وطب التجميل", "Dermatology, Aesthetic and Laser Medicine");
const JEDDAH = { branchAr: "فرع جدة", branchEn: "Jeddah Branch" };
const P = "3a226e09-ab88-3c76-e47d-841242a0c473";
const Q = "3a226dfc-b35f-f29a-1eb6-8fb2c25b2c34";
const R = "3a226d6f-a4de-37d4-105d-18b169df9c50";

export const DERMA_DOCTORS: Doc[] = [
  doc(
    "3a226d58-57be-88ab-f201-49a54c0fd79a71971d19-8928-441e-95a9-4a36db83d769-imageUrl_ar..jpg",
    "د. عبدالله العيسى",
    "Dr. Abdullah Aleisa",
    "استشاري الأمراض الجلدية والطب التجميلي، ومؤسس ورئيس مجلس إدارة عيادات ديرما",
    "Consultant in Dermatology and Aesthetic Medicine; Founder and Chairman of Derma Clinics",
    "skin",
    {
      founder: true,
      bioAr:
        "أسس العيادات عام 1996 برؤية رائدة جعلتها من أوائل المراكز المتخصصة في الجلدية والتجميل وزراعة الشعر في المملكة، وساهم في إدخال تقنيات البوتوكس، والفيلر، والليزر إلى المملكة العربية السعودية.",
      bioEn:
        "He founded the clinics in 1996 with a pioneering vision that made them among the first specialised centres for dermatology, aesthetics and hair transplantation in the Kingdom, and helped introduce Botox, fillers and laser technologies to Saudi Arabia.",
    },
  ),
  doc(`${P}abc77bf3-09f5-49fb-a9db-d7ded0850a5c-src_ar..jpg?v=0`, "د. عبد العزيز النوشان", "Dr. Abdulaziz Alnoshan", DERM_LASER.ar, DERM_LASER.en, "skin"),
  doc(`${P}3e723497-ce2f-4f7e-a0c0-f786caa34874-src_ar..jpg?v=0`, "أ.د. فهد السيف", "Prof. Dr. Fahad Alsaif", DERM_LASER.ar, DERM_LASER.en, "skin"),
  doc(`${P}4101fa9b-4c01-42bb-af61-f105185411d2-src_ar..jpg?v=0`, "د. عصام حماده", "Dr. Issam Hamadah", "استشاري طب الجلد والتجميل و الليزر", "Consultant in Dermatology, Aesthetic and Laser Medicine", "skin"),
  doc(`${P}406a0f4f-888f-4955-8711-19b88a202489-src_ar..jpg?v=0`, "د. مصطفى شبّار", "Dr. Mustafa Chabbar", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${P}fb540655-2625-453c-ad35-40a731701e9e-src_ar..jpg?v=0`, "د. رنا المارك", "Dr. Rana Almarek", "استشارية الأمراض الجلدية وطب التجميل والليزر", "Consultant in Dermatology, Aesthetic and Laser Medicine", "skin"),
  doc(`${P}b72c238d-b0b6-4686-845c-ec873f6b61e4-src_ar..jpg?v=0`, "د. محمد السعيدان", "Dr. Mohammed Alsaidan", "استشاري أمراض الجلدية", "Consultant in Dermatology", "skin"),
  doc(`${P}890b7173-62e3-4717-8616-e08280b3ec2f-src_ar..jpg?v=0`, "د. محمد طه", "Dr. Mohammed Taha", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${P}f9385a19-dbe1-420e-a3ef-f45885512319-src_ar..jpg?v=0`, "د. دانه العيسى", "Dr. Dana Alessa", "استشارية امراض الجلدية والتجميل", "Consultant in Dermatology and Aesthetic Medicine", "skin"),
  doc("3a226e29-4da4-4466-26c6-b6c5d3307fa61910777e-978f-4b10-9118-10602c859395-src_ar..jpg?v=0", "د. عبدالعزيز الهويش", "Dr. Abdulaziz Al-Howaish", DERM_AES.ar, DERM_AES.en, "skin"),
  doc("3a226e29-4da4-4466-26c6-b6c5d3307fa6e38a06a2-c282-4aef-926a-8b118a0d6499-src_ar..jpg?v=0", "د. محمد التركماني", "Dr. Mohammed Turkmani", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${Q}12a8a97e-4b3a-4af6-91f9-7986bee39d9e-src_ar..jpg?v=0`, "د. أسماء الحديثي", "Dr. Asmaa Al-Hudaity", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${Q}ce1d1303-7a5d-44b9-8675-fb0c319cc022-src_ar..jpg?v=0`, "د. باسل خوري", "Dr. Basl Khwree", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${Q}28dffe43-0457-447e-9ef0-ec5f88c5ebfe-src_ar..jpg?v=0`, "د. أنس غزال", "Dr. Anas Ghazal", DERM_AES.ar, DERM_AES.en, "skin", JEDDAH),
  doc(`${Q}e3255fd9-a2e8-460b-8560-23bfa4370b50-src_ar..jpg?v=0`, "د. مروان أسعد", "Dr. Marwan Assad", DERM_AES.ar, DERM_AES.en, "skin", JEDDAH),
  doc(`${Q}e87b2355-c5d5-4e09-ba2b-d3fb0af45ea3-src_ar..jpg`, "د. بسام جباعي", "Dr. Bassam Jibaii", "زراعة الشعر", "Hair Transplant", "hair"),
  doc("3a226e17-3a8c-59e7-5957-8066f3d292568e64403f-f37e-4a45-884b-964fe021a739-src_ar..jpg?v=0", "د. باسل غويش", "Dr. Bassel Gwaish", DERM_AES.ar, DERM_AES.en, "skin"),
  doc("3a226e17-3a8c-59e7-5957-8066f3d292565da0d8f1-d37a-41c1-9c43-605d01bff1a7-src_ar..jpg?v=0", "د. سوزان شلبي", "Dr. Suzan Shalaby", DERM_AES.ar, DERM_AES.en, "skin"),
  doc(`${R}6cf11e29-6e08-49ac-bf49-e4c379c30fb7-src_ar..jpg?v=0`, "د. نجد العيسى", "Dr. Najd Aleisa", "طب أسنان أسرة", "Family Dentistry", "dental"),
  doc(`${R}25b28198-b73a-4435-98b9-436861dbf4a2-src_ar..jpg?v=0`, "د. فيصل الشريف", "Dr. Faisal Alsharif", "جراحة الوجه و الفكين وزراعة الأسنان", "Oral Maxillofacial Surgery & Dental Implant", "dental"),
  doc(`${R}5549794f-2549-4e4b-8c98-20993d9ce8cf-src_ar..jpg?v=0`, "د. دلال الماضي", "Dr. Dalal Almadha", "تقويم الأسنان و الوجه والفكين", "Orthodontics", "dental"),
  doc(`${R}619f625e-7bc3-4e0e-bd2d-ada337f02050-src_ar..jpg?v=0`, "د. صالح العساف", "Dr. Saleh Alassaf", "طب وجراحة اللثة وزراعة الأسنان", "Periodontics", "dental"),
  doc(`${R}c08fc530-b888-4247-a1be-9557232439fb-src_ar..jpg?v=0`, "د. معالي العبدلي", "Dr. Maali Alabdali", "طب أسنان أسرة", "Family Dentistry", "dental"),
  doc(`${R}3c259c08-5f77-4ba9-bf0d-2bfe1c831d56-src_ar..jpg?v=0`, "د. سجى العبيدي", "Dr. Saja Alobaidi", "طب وجراحة الفم والأسنان", "Dentistry and Oral Surgery", "dental"),
  doc("3a226e19-97ef-6817-c4df-91d10c9be369369d8c45-f7d0-42ec-a7be-3e4978420bfe-src_ar..jpg?v=0", "د. علي المجلي", "Dr. Ali AlMujali", "جراحة تجميل الوجه والفكين", "Maxillofacial Surgery", "plastic"),
  doc(`${R}bc4edbe2-f168-4f43-bd75-5369239e21c5-src_ar..jpg?v=0`, "د. بسام العويرضي", "Dr. Bassam AlAwirdhi", "استشاري جراحة التجميل والترميم", "Consultant in Plastic and Reconstructive Surgery", "plastic"),
  doc(`${R}96b55afa-d9d1-4391-a961-978e5186ae3e-src_ar..jpg?v=0`, "د. عباس ياسين", "Dr. Abbas Yassin", "جراحة التجميل والترميم", "Plastic and Reconstructive Surgery", "plastic"),
  doc("3a226e19-97ef-6817-c4df-91d10c9be369394998f9-9545-45b7-b7d5-15810ce6b05e-src_ar..jpg?v=0", "د. حسن أبو صالح", "Dr. Hassan Abusalih", "استشاري جراحة التجميل والترميم", "Consultant in Plastic and Reconstructive Surgery", "plastic"),
];

const L27 = "3a226d27-aa85-3c98-b407-0db3c07238c4";
const L45 = "3a226d45-44bf-a6eb-7d24-987bca25b8e1";
const logo = (file: string, nameAr: string, nameEn: string) => ({
  nameAr,
  nameEn,
  logo: DERMA_IMG(file, 480),
});
export const DERMA_PARTNERS = [
  logo(`${L27}ea540a1e-095b-46c7-b303-62f40d101de2-src_ar..png?v=0`, "أمانة منطقة الرياض", "Riyadh Region Municipality"),
  logo(`${L27}2515bf2b-7a9f-4585-b681-3e9c575ce89e-src_ar..png?v=0`, "وزارة الحرس الوطني", "Ministry of National Guard"),
  logo(`${L27}e44eb202-7c78-49ea-a312-056fc0d0157f-src_ar..png?v=0`, "سابك", "SABIC"),
  logo(`${L27}00ff37d3-fb59-4574-9158-3ab46c89f7c9-src_ar..png?v=0`, "stc", "stc"),
  logo(`${L27}4f807def-bc77-4855-b9f8-955cb6451145-src_ar..png?v=0`, "مجلس الشورى", "The Shura Council"),
  logo(`${L27}4635fc00-b278-4d57-a97e-ea429f6fca50-src_ar..png?v=0`, "وزارة العمل والتنمية الاجتماعية", "Ministry of Labor and Social Development"),
  logo(`${L27}a643105c-c059-4f1a-93b1-8ae159e59528-src_ar..png?v=0`, "وزارة الإعلام", "Ministry of Media"),
  logo(`${L27}397033d3-b1cc-4144-8c9c-18ceb07cee47-src_ar..png?v=0`, "المديرية العامة لمكافحة المخدرات", "General Directorate of Narcotics Control"),
  logo(`${L27}918d7cfb-4a9e-45da-92ae-a7e0d358cff4-src_ar..png?v=0`, "البنك السعودي الفرنسي", "Banque Saudi Fransi"),
  logo(`${L27}160485d4-c02c-4077-8260-57bfab66633e-src_ar..png?v=0`, "وزارة السياحة", "Ministry of Tourism"),
  logo(`${L45}ed770fd0-2f21-4628-92b0-41024ce2d5f2-src_ar..png?v=0`, "بنك الجزيرة", "Bank AlJazira"),
  logo(`${L45}2661a4f7-b999-407e-b724-26df9bb95c00-src_ar..png?v=0`, "طيران ناس", "flynas"),
  logo(`${L45}daf3e3c1-1ee1-43fe-a9a8-0a23350c12d8-src_ar..png?v=0`, "وزارة الثقافة", "Ministry of Culture"),
  logo(`${L45}dbc5b556-1557-43e9-acc4-5148208e815b-src_ar..png?v=0`, "السعودية", "Saudia"),
  logo(`${L45}9b666fa7-a04b-4a84-86fc-0fe53df2df46-src_ar..png?v=0`, "مستشفى الملك فيصل التخصصي ومركز الأبحاث", "King Faisal Specialist Hospital & Research Centre"),
  logo(`${L45}871a4981-fb57-4b0e-b37a-a0b037745026-src_ar..png?v=0`, "وزارة الرياضة", "Ministry of Sport"),
  logo(`${L45}ce1124af-0b83-459f-b82d-2e0348e99d69-src_ar..png?v=0`, "مركز الملك عبدالله المالي", "KAFD"),
  logo(`${L45}5667486e-0887-4dd7-a42c-6b76a840746d-src_ar..png?v=0`, "شركة الدرعية", "Diriyah Company"),
  logo(`${L45}c71d025c-cc0e-493c-b1f3-aae42ed8b316-src_ar..png?v=0`, "بنك الرياض", "Riyad Bank"),
  logo(`${L45}78a5b0b3-308b-4a3d-8e2d-00754ab6e941-src_ar..png?v=0`, "بوبا", "Bupa"),
];

/** Every procedure from their department pages, grouped for browsing. */
export const DERMA_SILOS = [
  {
    key: "laser",
    dept: "skin",
    nameAr: "الليزر والأجهزة",
    nameEn: "Laser & Devices",
    items: [
      I("ليزر إزالة الشعر", "Laser Hair Removal"),
      I("ليزر الفراكشنال", "Fractional Laser"),
      I("الليزر الوعائي", "Vascular Laser"),
      I("إزالة التصبغات بالليزر", "Laser Pigmentation Removal"),
      I("إزالة الوشم بالليزر", "Laser Tattoo Removal"),
      I("جهاز سكارليت RF", "Scarlet RF"),
      I("مورفيوس 8", "Morpheus8"),
      I("ألثيرا", "Ultherapy"),
    ],
  },
  {
    key: "injectables",
    dept: "skin",
    nameAr: "الحقن",
    nameEn: "Injectables",
    items: [
      I("حقن البوتوكس", "Injectable Botox"),
      I("حقن الفيلر", "Injectable Fillers"),
      I("حقن النضارة", "Injectable Skin Boosters"),
      I("الإكسوسومات", "Exosomes"),
      I("البلازما", "Platelet-Rich Plasma (PRP)"),
      I("الفيبرين الغني بالصفائح الدموية", "Platelet-Rich Fibrin (PRF)"),
      I("الميزوثيرابي", "Mesotherapy"),
      I("حقن الكورتيزون", "Cortisone Injection"),
    ],
  },
  {
    key: "skin",
    dept: "skin",
    nameAr: "علاجات البشرة",
    nameEn: "Skin Treatments",
    items: [
      I("استشارة", "Consultation"),
      I("التقشير الكيميائي", "Chemical Peeling"),
      I("تنظيف البشرة", "Facial Treatment"),
      I("علاج تجديد البشرة", "Skin Rejuvenation Treatment"),
      I("شد الوجه بالخيوط", "Thread Lift"),
      I("علاج البهاق", "Vitiligo Treatment"),
      I("ترقيع طبقة البشرة السطحية", "Epidermal Graft"),
    ],
  },
  {
    key: "medical",
    dept: "skin",
    nameAr: "الجلدية الطبية",
    nameEn: "Medical Dermatology",
    items: [
      I("اختبار الحساسية الجلدية", "Patch Test"),
      I("خزعة الأنسجة", "Punch Biopsy"),
      I("الكي الكهربائي", "Electrocautery"),
      I("العلاج بالتبريد", "Cryotherapy"),
      I("إجراء بتخدير موضعي", "Local Anesthesia Procedure"),
    ],
  },
  {
    key: "hair",
    dept: "hair",
    nameAr: "زراعة واستعادة الشعر",
    nameEn: "Hair Restoration & Transplantation",
    items: [
      I("استشارة طبيب استشارى", "Consultation"),
      I("زراعة شعر فروة الرأس بتقنية الاقتطاف", "FUE Scalp Procedure"),
      I(
        "زراعة الشعر بتقنية الاقتطاف (FUE) للذقن والشارب والحواجب وفروة الرأس وخط الشعر والندبات والسوالف",
        "FUE – Beard / Mustache / Eyebrow / Scalp / Hairline / Scar / Sideburn Hair Transplantation",
      ),
      I("علاج البلازما للشعر (PRP / التجديد / الإكسوسوم)", "HT Plasma (PRP / Regenerative / Exosome)"),
      I("علاج الإكسوسوم للخلايا", "HT Exosome Cell Therapy"),
      I("علاج الندبات", "HT Scar Revision"),
      I("الميزوثيرابي", "HT Mesotherapy"),
      I("جلسة ليزر لتحفيز نمو الشعر", "HT Laser Hair Growth Session"),
      I("علاج استعادة الشعر", "Hair Restoration Treatment"),
    ],
  },
  {
    key: "face",
    dept: "plastic",
    nameAr: "جراحات الوجه",
    nameEn: "Face",
    items: [
      I("استشارة الطبيب", "Consultation"),
      I("تجميل الأنف", "Rhinoplasty"),
      I("جراحة تجميل الجفون", "Blepharoplasty"),
      I("شد الوجه والرقبة", "Facelift & Neck Lift"),
      I("شفط دهون الذقن", "Chin Liposuction"),
      I("صناعة الغمازات", "Dimple Creation"),
      I("حقن الدهون الذاتية", "Fat Grafting"),
      I("تجميل الأذن", "Otoplasty"),
    ],
  },
  {
    key: "body",
    dept: "plastic",
    nameAr: "جراحات الجسم",
    nameEn: "Body",
    items: [
      I("تكبير الثدي", "Breast Augmentation"),
      I("تصغير الثدي", "Breast Reduction"),
      I("رفع الثدي", "Breast Lift"),
      I("شفط الدهون", "Liposuction"),
      I("شد البطن", "Tummy Tuck (Abdominoplasty)"),
      I("شد الذراعين", "Arm Lift"),
      I("شد الفخذين", "Thigh Lift"),
      I("تنسيق القوام", "Body Contouring"),
      I("جراحة التثدي لدى الرجال", "Gynecomastia Surgery"),
    ],
  },
  {
    key: "dental-diagnostic",
    dept: "dental",
    nameAr: "التشخيص والوقاية",
    nameEn: "Diagnostic & Preventive",
    items: [
      I("الفحص", "Examination"),
      I("أشعة داخل الفم (PA)", "Intraoral Radiograph (PA)"),
      I("أشعة بانورامية (OPG)", "Panoramic Radiograph (OPG)"),
      I("الأشعة المقطعية المخروطية (CBCT)", "CBCT"),
      I("أشعة قياس الرأس", "Cephalometric Radiograph"),
      I("نموذج الدراسة", "Study Model"),
    ],
  },
  {
    key: "dental-treatment",
    dept: "dental",
    nameAr: "علاجات الأسنان",
    nameEn: "Dental Treatments",
    items: [
      I("طب الأسنان الإصلاحي", "Restorative"),
      I("علاج لب و جذور الأسنان", "Endodontics"),
      I("طب و جراحة اللثة", "Periodontics"),
      I("طب استعاضة و تركيبات الاسنان", "Prosthodontics"),
      I("طب أسنان الاطفال", "Pediatric Dentistry"),
      I("جراحة فم ووجه وفكين", "Oral & Maxillofacial Surgery"),
      I("زراعة أسنان", "Dental Implants"),
      I("تقويم الأسنان", "Orthodontics"),
    ],
  },
];

export const DERMA_SITE = {
  eyebrowAr: "نحن نبتكر المستقبل",
  eyebrowEn: "We Innovate the Future",
  headlineAr: "وجهتك المتكاملة للجلدية وجراحة التجميل وزراعة الشعر وطب الأسنان في الرياض",
  headlineEn:
    "Your Complete Destination for Dermatology, Plastic Surgery, Hair Transplant & Dental Care in Riyadh",
  aboutAr:
    "أسست عيادات ديرما عام 1996، وتُعد من أبرز الوجهات الطبية المتخصصة في المملكة العربية السعودية في طب الجلدية، والطب التجميلي، وجراحة التجميل، وزراعة الشعر، وطب الأسنان. وبخبرة تمتد لأكثر من ثلاثة عقود، نجمع بين أحدث التقنيات الطبية، ونخبة من الأطباء والاستشاريين، وخطط علاجية مصممة وفق احتياجات كل مريض، لنقدم رعاية آمنة ونتائج طبيعية ومتميزة. وتواصل عيادات ديرما التزامها بتقديم خدمات صحية وتجميلية متكاملة، لتكون وجهة موثوقة للمرضى في الرياض ومختلف أنحاء المملكة.",
  aboutEn:
    "Established in 1996, Derma Clinics is one of Saudi Arabia's leading destinations for dermatology, aesthetic medicine, plastic surgery, hair transplantation, and dental care. With decades of experience, we combine advanced medical technology, highly qualified specialists, and personalized treatment plans to deliver safe, effective, and natural-looking results. Our commitment to excellence has made Derma Clinics a trusted choice for patients seeking comprehensive healthcare and aesthetic services in Riyadh and across Saudi Arabia.",
  clinicsAr:
    "اكتشف عياداتنا المتخصصة، حيث تجتمع الخبرة الطبية، وأحدث التقنيات، والخطط العلاجية المخصصة لتقديم أفضل مستويات الرعاية. نقدم خدمات الجلدية والطب التجميلي، وجراحة التجميل، وطب الأسنان، وزراعة واستعادة الشعر، وعلاجات الليزر من خلال فريق متعدد التخصصات، لنمنح مرضانا تجربة علاجية متكاملة في الرياض.",
  clinicsEn:
    "Discover our specialized clinics, where expert care, advanced technology, and personalized treatments come together. From dermatology and aesthetic medicine to plastic surgery, dental care, hair restoration, and laser treatments, our multidisciplinary team is dedicated to delivering comprehensive healthcare and exceptional patient experiences in Riyadh.",
  doctorsAr:
    "تعرّف على نخبة من أطبائنا واستشاريينا المتخصصين، الذين يجمعون بين الخبرة الطبية وأحدث التقنيات لتقديم رعاية صحية وتجميلية متكاملة. يلتزم فريقنا بتقديم خطط علاجية مخصصة ونتائج متميزة تلبي احتياجات كل مريض.",
  doctorsEn:
    "Meet our team of highly qualified specialists dedicated to providing exceptional medical and aesthetic care. With extensive experience across multiple specialties, our doctors combine expertise, innovation, and compassion to deliver personalized treatments and outstanding patient outcomes.",
  findAr: "اكتشف مواقع عياداتنا واستمتع برعاية متخصصة في بيئة عصرية ومريحة",
  findEn: "Explore our clinic locations and receive personalized care in a comfortable, modern environment",
  footerAr: "عيادات ديرما | أفضل عيادات جلدية وتجميل بالرياض بخبرة +30 عاماً",
  footerEn:
    "Leading dermatology and aesthetic clinic in Riyadh, offering plastic surgery, hair transplant, dental care, laser treatments and advanced cosmetic procedures.",
  since: 1996,
  phone: "9200 33055",
  whatsapp: "+966550883080",
  instagram: "dermaclinics",
  x: "dermaclinics",
  tiktok: "derma_clinics",
  departments: [
    {
      key: "skin",
      nameAr: "طب الجلدية والطب التجميلي وزراعة الشعر",
      nameEn: "Dermatology, Aesthetic Medicine & Hair Transplantation",
      textAr:
        "يقدم قسم طب الجلدية والطب التجميلي وزراعة الشعر في عيادات ديرما رعاية طبية متكاملة تهدف إلى الحفاظ على صحة البشرة والشعر وفروة الرأس، مع توفير أحدث الحلول العلاجية والتجميلية وفق أعلى المعايير الطبية العالمية.",
      textEn:
        "At Derma Clinics, our Department of Dermatology, Aesthetic Medicine & Hair Transplantation is dedicated to delivering comprehensive, patient-centered care for healthy skin, hair, and scalp.",
      specialties: ["skin", "hair"],
    },
    {
      key: "dental",
      nameAr: "طب الأسنان",
      nameEn: "Dental Care",
      textAr:
        "تبدأ الابتسامة الصحية برعاية متخصصة. يقدم أطباء الأسنان لدينا خدمات وقائية وترميمية وتجميلية شاملة باستخدام أحدث التقنيات.",
      textEn:
        "Healthy smiles begin with expert care. Our dental specialists provide comprehensive preventive, restorative, and cosmetic treatments using advanced technology.",
      specialties: ["dental"],
    },
    {
      key: "plastic",
      nameAr: "جراحة التجميل",
      nameEn: "Plastic Surgery",
      textAr:
        "اكتشف خدمات جراحة التجميل في عيادات ديرما، بما يشمل تجميل الوجه ونحت الجسم والجراحات الترميمية، مع رعاية مخصصة ونتائج طبيعية وآمنة.",
      textEn:
        "Explore expert plastic surgery at Derma Clinics, offering facial and body contouring, reconstructive procedures, and personalized care for natural-looking results.",
      specialties: ["plastic"],
    },
  ],
  specialties: [
    {
      key: "skin",
      nameAr: "الجلدية والطب التجميلي",
      nameEn: "Dermatology & Aesthetic Medicine",
      textAr: "علاجات متقدمة لبشرة صحية، نضرة، وجمال طبيعي",
      textEn: "Advanced treatments for healthy, radiant, naturally beautiful skin",
      bookable: true,
    },
    {
      key: "dental",
      nameAr: "طب الأسنان التجميلي والعام",
      nameEn: "Cosmetic & General Dentistry",
      textAr: "رعاية شاملة للأسنان وعلاجات تجميلية متقدمة تمنحك ابتسامة صحية وواثقة",
      textEn:
        "Comprehensive dental care and cosmetic treatments designed to give you a healthy, confident smile",
    },
    {
      key: "hair",
      nameAr: "زراعة واستعادة الشعر",
      nameEn: "Hair Restoration & Transplantation",
      textAr: "استعد كثافة شعرك مع أحدث تقنيات زراعة الشعر لنتائج طبيعية تدوم",
      textEn:
        "Restore natural hair growth with advanced hair transplant solutions for fuller, lasting results",
    },
    {
      key: "plastic",
      nameAr: "جراحة التجميل",
      nameEn: "Plastic Surgery",
      textAr: "عزز جمالك الطبيعي مع إجراءات جراحية متخصصة تمنحك نتائج متناسقة وطبيعية",
      textEn:
        "Enhance your natural beauty with personalized surgical procedures for balanced, refined results",
    },
  ],
  silos: DERMA_SILOS,
  doctors: DERMA_DOCTORS,
  partners: DERMA_PARTNERS,
  images: {
    logo: DERMA_IMG("3a213be0-b312-6824-9841-00091fad37e5.png", 416),
    hero: DERMA_IMG(
      "3a227765-84cc-8c5d-70a3-815449f9448f33cb4186-45ab-407f-9754-e20d32d1aca0-imageSrc_ar..jpg?v=0",
      1800,
    ),
    "brand-clinics": DERMA_IMG("3a22693b-e4c4-1202-7d4c-279dce26c2aa769eb594-5739-4d7b-ba09-7bf79e1b1aa9-src_ar..png?v=0", 800),
    "brand-dental": DERMA_IMG("3a226cac-be67-9d06-85bd-5d46439603fc6c5648bd-44d2-4d3f-b24d-f0b0b1694f61-src_ar..png?v=0", 800),
    "brand-light": DERMA_IMG("3a226cbf-e01f-2017-6e96-9a202b74c7854d13d545-fd86-493c-922f-015dca73786a-src_ar..png?v=0", 800),
    "brand-hair": DERMA_IMG("3a226cbf-e01f-2017-6e96-9a202b74c78521a12dfb-fe0d-49bf-b6ac-1c90d4d54ef0-src_ar..png?v=0", 800),
    "service-skin": DERMA_IMG("3a226846-3c98-d4a0-5c98-cbd6ba17a49dafc2b28e-aaae-4e0c-b2ba-de41d655cc7c-imageSrc_ar..png?v=0"),
    "service-dental": DERMA_IMG("3a226846-3c98-d4a0-5c98-cbd6ba17a49d58133624-9fd2-4869-a6c3-fd35173b2ca3-imageSrc_ar..png?v=0"),
    "service-hair": DERMA_IMG("3a226846-3c98-d4a0-5c98-cbd6ba17a49db2cb11bf-b6a6-46b8-acb1-713ff0f16dba-imageSrc_ar..png?v=0"),
    "service-plastic": DERMA_IMG("3a226846-3c98-d4a0-5c98-cbd6ba17a49db8907f42-6208-445f-8674-09112d47b8f6-imageSrc_ar..png?v=0"),
    "dept-skin": DERMA_IMG("3a2277e4-c450-dcea-3431-922aa127a805cd812751-4c8b-448e-81d7-cf3931863590-imageUrl_ar..jpg?v=0", 1400),
    "dept-hair": DERMA_IMG("3a2277c6-02eb-e60a-cdb0-50e099bbff2e8d47da9c-385f-4986-bd70-44f11042b237-imageUrl_ar..jpg?v=0", 1400),
    "dept-dental": DERMA_IMG("3a2277cf-5283-7cb7-2020-d0883e11a17184a13b42-7df3-4fcf-acc7-5cd620ba25e5-imageUrl_ar..jpg", 1400),
    "dept-plastic": DERMA_IMG("3a2277a6-bc43-d721-eea1-b120cf51c90d3adee8ae-a3fa-4c21-bcbf-3ac9af9468c2-imageUrl_ar..jpg", 1400),
    "plastic-face": DERMA_IMG("3a227d2a-c17e-5a9c-c576-495eef60adbef2d2fb13-a7d1-4896-890a-9c8122f83ac5-imageSrc_ar..png", 1200),
    visit: DERMA_IMG("3a226d23-54da-ed47-082c-d8b14601347d95b59545-b5ee-4bb9-834b-338e9fa1af32-imageUrl_ar..png?v=0", 1200),
  },
};
