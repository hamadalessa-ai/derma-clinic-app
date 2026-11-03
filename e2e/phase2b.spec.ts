/**
 * Phase 2b browser tests (desktop and phone sizes): WhatsApp in DEMO mode.
 * Start from a fresh demo database:  pnpm db:local && pnpm dev  then  pnpm e2e
 * (needs MESSAGE_DEMO_MODE=on in .env.local).
 *
 *  1. Book online (WhatsApp ticked) → the confirmation appears in the WhatsApp simulator.
 *  2. "Run scheduled messages now" → the reminder appears → tap Confirm → reception's calendar
 *     shows the appointment as confirmed.
 *  3. Complete a visit → run (fast-forward 24 h) → post-care check-in → tap "I have a concern" →
 *     Dr. Sara follows her notification's link (from the push log) to the patient's file, replies
 *     (signed, seen in the simulator), asks for a photo (the patient sends one), leaves reception a
 *     note and a follow-up request, then marks it resolved. Reception sees her reply, note and
 *     "photo received" in the inbox, and books the follow-up from Requests.
 *     (A browser can't receive a real push: sending is tested in tests/push-log.test.ts.)
 *  4. A message from a number that isn't a patient → inbox "new numbers" → create the patient.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

function ctxOptions(isMobile: boolean) {
  return isMobile
    ? {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
        timezoneId: "Asia/Riyadh",
      }
    : { viewport: { width: 1280, height: 900 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" };
}

async function staff(browser: Browser, email: string, isMobile: boolean) {
  const page = await (await browser.newContext(ctxOptions(isMobile))).newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

/** A small fake "photo of the area" (32×32 PNG, skin-coloured). */
const PHOTO_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIie3WywkAMBBCwdRuEVZnMakikMPA3oXFzztrnt4hUC8KF03QoiqmTWtwZjKLKgK8Ch3zNV1fOs/QanH4UegAAAAASUVORK5CYII=";

let seq = 0;
const freshPhone = () => `0597${String((Date.now() + seq++ * 7919) % 1_000_000).padStart(6, "0")}`;

async function noSidewaysScroll(page: Page) {
  const sw = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sw).toBeLessThanOrEqual(1);
}

/** Books on /book with Dr. Sara, WhatsApp ticked: the first free time from tomorrow on. */
async function bookOnline(page: Page, opts: { service: RegExp; phone: string; name: string }) {
  await page.goto("/book");
  await page
    .getByTestId("step-branch")
    .getByRole("button", { name: /الرياض/ })
    .click();
  await page
    .getByTestId("step-service")
    .getByRole("button", { name: opts.service })
    .first()
    .click();
  await page
    .getByTestId("step-doctor")
    .getByRole("button", { name: /سارة العتيبي/ })
    .click();
  const days = page.locator("[data-day]:not([disabled])");
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  for (let i = 0; i < (await days.count()); i++) {
    const chip = days.nth(i);
    const day = (await chip.getAttribute("data-day"))!;
    if (day <= today) continue;
    await chip.click();
    const times = page.getByTestId("times");
    await expect(times.locator("[data-time], [data-testid=no-times]").first()).toBeVisible();
    const first = times.locator("[data-time]").first();
    if (!(await first.count())) continue;
    await first.click();
    await page.getByLabel("الاسم الكامل").fill(opts.name);
    await page.getByLabel("رقم الجوال").fill(opts.phone);
    await page.getByText("أنثى").click();
    await page.getByTestId("whatsapp-opt-in").check();
    await page.getByTestId("send-code").click();
    const code = (await page.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await page.getByLabel("رمز التحقق").fill(code);
    await page.getByTestId("confirm").click();
    await expect(page.getByTestId("booking-done")).toBeVisible();
    await page.getByTestId("open-my").click();
    const fileNumber = (await page.locator("main p[dir=ltr]").first().textContent())!.trim();
    return { day, fileNumber };
  }
  throw new Error("no free online time found for Dr. Sara");
}

/** Opens a patient's chat in the simulator (by phone number) and returns the phone frame. */
async function openSimulatorChat(page: Page, phone: string) {
  await page.goto("/whatsapp/simulator");
  await page.locator(`[data-testid=conversation][data-phone="${phone}"]`).click();
  const frame = page.getByTestId("simulator-phone");
  await expect(frame).toBeVisible();
  return frame;
}

async function runNow(page: Page, fastForward: boolean) {
  await page.goto("/whatsapp/simulator");
  const panel = page.getByTestId("run-now");
  await panel.getByTestId("ignore-quiet").check();
  if (fastForward) await panel.getByTestId("fast-forward").check();
  await panel.getByTestId("run-now-button").click();
  await expect(panel.getByRole("status")).toBeVisible();
}

test.describe("WhatsApp in demo mode", () => {
  test("booking → confirmation → run scheduled → reminder → Confirm → calendar shows confirmed", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const patient = await (await browser.newContext(ctxOptions(isMobile))).newPage();
    const phone = freshPhone();
    const booked = await bookOnline(patient, {
      service: /استشارة طبية/,
      phone,
      name: "مريضة واتساب تجريبية",
    });

    const admin = await staff(browser, "admin@derma.demo", isMobile);
    let chat = await openSimulatorChat(admin, phone);
    await expect(chat.locator("[data-kind=booking_confirmation]")).toBeVisible();
    await expect(chat.locator("[data-kind=booking_confirmation]")).toContainText(
      "موعد استشارة طبية",
    );
    await expect(admin.getByTestId("demo-label")).toBeVisible();
    await noSidewaysScroll(admin);

    // The reminder: due within 24 h — or tomorrow-ish, so fast-forward if needed.
    await runNow(admin, false);
    chat = await openSimulatorChat(admin, phone);
    if (!(await chat.locator("[data-kind=reminder]").count())) {
      await runNow(admin, true);
      chat = await openSimulatorChat(admin, phone);
    }
    const reminder = chat.locator("[data-kind=reminder]");
    await expect(reminder).toBeVisible();
    await chat.locator('[data-testid=chat-button][data-button="تأكيد"]').last().click();
    await expect(chat.locator("[data-kind=confirm_ack]")).toBeVisible();

    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto(`/calendar?date=${booked.day}`);
    const block = reception.locator(
      `[data-testid=appointment][data-patient="${booked.fileNumber}"]`,
    );
    await expect(block).toHaveAttribute("data-status", "confirmed");
    await block.click();
    await expect(reception.getByTestId("appointment-whatsapp")).toContainText("تذكير");
  });

  test("post-care concern: doctor opens it from the push, replies, gets a photo, follow-up, resolves", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const patient = await (await browser.newContext(ctxOptions(isMobile))).newPage();
    const phone = freshPhone();
    const booked = await bookOnline(patient, {
      service: /جلسة تنظيف البشرة/,
      phone,
      name: "مريضة متابعة تجريبية",
    });

    // Reception: check in, start, complete (a visit done early for the demo).
    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto(`/calendar?date=${booked.day}`);
    await reception
      .locator(`[data-testid=appointment][data-patient="${booked.fileNumber}"]`)
      .click();
    await reception.getByTestId("check-in").click();
    await expect(reception.getByText(/تم تسجيل الحضور/)).toBeVisible();
    await reception.getByRole("button", { name: "بدء الجلسة" }).click();
    await expect(reception.getByRole("button", { name: "إنهاء الجلسة" })).toBeVisible();
    await reception.getByRole("button", { name: "إنهاء الجلسة" }).click();
    await expect(
      reception.locator(`[data-testid=appointment][data-patient="${booked.fileNumber}"]`),
    ).toHaveAttribute("data-status", "completed");

    // Admin: run with fast-forward → the post-care check-in arrives; tap "I have a concern".
    const admin = await staff(browser, "admin@derma.demo", isMobile);
    await runNow(admin, true);
    const chat = await openSimulatorChat(admin, phone);
    await expect(chat.locator("[data-kind=post_care]")).toContainText("التنظيف");
    await chat.locator('[data-testid=chat-button][data-button="لدي استفسار/قلق"]').last().click();
    await expect(chat.locator("[data-kind=concern_ack]")).toBeVisible();

    // The admin status page shows what happened to the concern push (sent / no device / no keys…).
    await admin.goto("/settings/whatsapp/status");
    await expect(
      admin.locator("[data-testid=push-log-row][data-type=patient_concern]").first(),
    ).toBeVisible();

    // Dr. Sara taps her concern notification: it opens the patient's file (not "no permission")
    // with a "Concern" badge, the concern and the post-care conversation.
    const sentToSara = admin
      .locator(
        "[data-testid=push-log-row][data-type=patient_concern][data-user='usr_derma-dr-sara']",
      )
      .first();
    const link = (await sentToSara.getAttribute("data-link"))!;
    expect(link).toMatch(/^\/patients\/[0-9a-f-]{36}\?concern=/);
    const doctor = await staff(browser, "dr.sara@derma.demo", isMobile);
    await doctor.goto(link);
    await expect(doctor).not.toHaveURL(/forbidden/);
    const concern = doctor.locator("#concern[data-testid=patient-concern]");
    await expect(concern).toBeVisible();
    await expect(concern.getByTestId("concern-badge")).toHaveText("قلق");
    await expect(concern.locator("[data-kind=post_care]")).toContainText("التنظيف");
    await expect(concern.locator("[data-kind=inbound_button]").last()).toContainText(
      "لدي استفسار/قلق",
    );
    await noSidewaysScroll(doctor);

    // She replies from the card: the patient gets it from the clinic, signed with her name.
    await concern
      .getByTestId("concern-reply-text")
      .fill("الاحمرار الخفيف طبيعي، ضعي كمادات باردة.");
    await concern.getByTestId("concern-reply-send").click();
    await expect(concern.getByText("تم إرسال الرد.")).toBeVisible();
    const reply = concern.locator("[data-testid=chat-message][data-kind=staff_reply]").last();
    await expect(reply).toContainText("كمادات باردة");
    await expect(reply.getByTestId("chat-sender")).toContainText("سارة العتيبي");
    await concern.getByTestId("concern-ask-photo").click();
    await expect(concern.locator("[data-kind=photo_request]")).toBeVisible();

    // The patient's phone (simulator): the reply from the clinic, signed; then sends a photo.
    const phoneChat = await openSimulatorChat(admin, phone);
    await expect(phoneChat.locator("[data-kind=staff_reply]").last()).toContainText(
      "— د. سارة العتيبي",
    );
    await expect(phoneChat.locator("[data-kind=photo_request]")).toContainText("صورة واضحة");
    await phoneChat.getByTestId("simulator-photo").setInputFiles({
      name: "area.png",
      mimeType: "image/png",
      buffer: Buffer.from(PHOTO_PNG, "base64"),
    });
    await expect(phoneChat.locator("[data-kind=inbound_image]")).toBeVisible();

    // Dr. Sara sees the photo on the file; leaves reception a note; sends a follow-up request
    // (this clinic: doctors don't manage their own schedule).
    await doctor.reload();
    await expect(concern.getByTestId("chat-photo")).toBeVisible();
    await concern.getByTestId("concern-note-open").click();
    await concern.getByTestId("concern-note-text").fill("نرجو الاتصال بالمريضة للاطمئنان.");
    await concern.getByTestId("concern-note-save").click();
    await expect(concern.locator("[data-testid=concern-event][data-kind=note]")).toBeVisible();
    await concern.getByTestId("concern-followup-open").click();
    const fu = concern.getByTestId("concern-followup");
    await expect(fu).toHaveAttribute("data-mode", "request");
    await fu.getByTestId("followup-day").fill(booked.day);
    await fu.getByTestId("followup-find").click();
    await fu.locator("[data-testid=followup-times] [data-time]").last().click();
    await fu.getByTestId("followup-confirm").click();
    await expect(
      concern.locator("[data-testid=concern-event][data-kind=follow_up_request]"),
    ).toBeVisible();

    // It is on her My Day too (open until resolved).
    await doctor.goto("/my-day");
    const onMyDay = doctor.locator(`[data-testid=my-concern][data-patient="${booked.fileNumber}"]`);
    await expect(onMyDay).toBeVisible();

    // Reception: the inbox shows the doctor's reply (with her name), her note, and only
    // "photo received" (medical photos are for doctors); the follow-up request is ready to book.
    const inbox = await staff(browser, "reception.riyadh1@derma.demo", isMobile);
    await inbox.goto("/whatsapp?f=needs_reply");
    const row = inbox.locator(`[data-testid=conversation][data-phone="${phone}"]`);
    await expect(row).toContainText("قلق بعد الإجراء");
    await row.click();
    const thread = inbox.getByTestId("inbox-thread");
    await expect(thread).toBeVisible();
    await expect(
      thread
        .locator("[data-testid=chat-message][data-kind=staff_reply]")
        .first()
        .getByTestId("chat-sender"),
    ).toContainText("سارة العتيبي");
    await expect(thread.locator("[data-testid=concern-event][data-kind=note]")).toContainText(
      "نرجو الاتصال",
    );
    await expect(thread.getByTestId("chat-photo-hidden")).toBeVisible();
    await expect(thread.getByTestId("chat-photo")).toHaveCount(0);
    await inbox.getByTestId("reply-text").fill("مرحبًا، سنتصل بك خلال ساعة.");
    await inbox.getByTestId("reply-send").click();
    await expect(
      thread.locator("[data-kind=staff_reply] [data-testid=chat-sender]").last(),
    ).toBeVisible();
    await noSidewaysScroll(inbox);
    await inbox.goto("/requests");
    const request = inbox
      .getByTestId("followup-request")
      .filter({ hasText: "مريضة متابعة تجريبية" })
      .first();
    await request.getByTestId("followup-request-book").click();
    await expect(request).toHaveCount(0);

    // Dr. Sara marks it resolved → no longer on her My Day.
    await onMyDay.click();
    const card = doctor.locator("#concern[data-testid=patient-concern]");
    await card.getByTestId("concern-resolve-open").click();
    await card.getByTestId("concern-resolve-note").fill("تحسّنت الحالة.");
    await card.getByTestId("concern-resolve-confirm").click();
    await expect(card.locator("[data-testid=concern-event][data-kind=resolved]")).toBeVisible();
    await doctor.goto("/my-day");
    await expect(
      doctor.locator(`[data-testid=my-concern][data-patient="${booked.fileNumber}"]`),
    ).toHaveCount(0);
  });

  test("a number that isn't a patient lands in the inbox; reception creates the patient", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const admin = await staff(browser, "admin@derma.demo", isMobile);
    const phone = freshPhone();
    await admin.goto("/whatsapp/simulator");
    const form = admin.getByTestId("simulate-new-number");
    await form.getByLabel("رقم الجوال").fill(phone);
    await form.getByLabel("الاسم في واتساب (اختياري)").fill("Huda");
    await form.getByLabel("الرسالة").fill("السلام عليكم، هل يوجد عرض على الليزر؟");
    await form.getByRole("button", { name: "أرسل كمريض" }).click();
    await expect(admin.getByTestId("simulator-phone")).toBeVisible();

    const inbox = await staff(browser, "reception.riyadh1@derma.demo", isMobile);
    await inbox.goto("/whatsapp?f=new_contacts");
    const row = inbox.locator(`[data-testid=conversation][data-phone="${phone}"]`);
    await expect(row).toContainText("ليس مريضًا بعد");
    await row.click();
    const create = inbox.getByTestId("link-or-create");
    await create.getByLabel("الاسم الكامل").fill("هدى التجريبية");
    await create.getByText("أنثى").click();
    await create.getByTestId("create-patient").click();
    await expect(inbox).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
    await expect(inbox.getByTestId("whatsapp-consent")).toBeVisible();
  });
});
