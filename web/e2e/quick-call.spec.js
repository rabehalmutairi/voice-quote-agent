import { test, expect } from "@playwright/test";

async function chooseExample(page, outcome = "answered") {
  await page.goto("/request");
  await page.getByRole("button", { name: /اسأل عني/ }).click();
  await page.getByText("جرّب مثال الطباعة", { exact: true }).click();
  await page.getByRole("button", { name: "استخدم المثال" }).click();
  await page.getByLabel("حالة المحاكاة").selectOption(outcome);
  await page.getByRole("button", { name: "اعرض المحلات" }).click();
  await expect(page.getByRole("heading", { name: "من نَسأل عنك؟" })).toBeVisible();
}

test("explicit business selection, confirmation, evidence and route continuity", async ({ page }) => {
  await chooseExample(page);
  const blocked = page.getByRole("listitem").filter({ hasText: "رقم موحد 920" });
  await expect(blocked.getByRole("button")).toBeDisabled();
  await page.getByRole("button", { name: "اختر المحل مطبعة الحي التجريبية" }).click();
  await expect(page.getByRole("heading", { name: "نتصل بهذا المحل؟" })).toBeVisible();
  await page.waitForTimeout(2800);
  await expect(page.getByRole("heading", { name: "وصلنا الرد" })).not.toBeVisible();
  await page.getByRole("link", { name: "طلبك الحالي", exact: true }).click();
  await page.getByRole("button", { name: "أكّد وابدأ الاتصال التجريبي" }).click();
  await expect(page.getByRole("heading", { name: "وصلنا الرد" })).toBeVisible();
  await page.getByText("اقرأ الدليل من المكالمة", { exact: true }).click();
  await page.getByRole("button", { name: "عرض الدور في المحادثة" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const outcome of ["no_answer", "not_mentioned"]) {
  test(`handles ${outcome} without substitutes or invented answers`, async ({ page }) => {
    await chooseExample(page, outcome);
    await page.getByRole("button", { name: "اختر المحل مطبعة الحي التجريبية" }).click();
    await page.getByRole("button", { name: "أكّد وابدأ الاتصال التجريبي" }).click();
    await expect(page.getByRole("heading", { name: outcome === "no_answer" ? "ما قدرنا نوصل للمحل" : "انتهت المكالمة بدون إجابة" })).toBeVisible();
    await expect(page.getByText("نطبع A2 اليوم بعشرين ريال للورقة.", { exact: true })).not.toBeVisible();
    if (outcome === "not_mentioned") await expect(page.getByText("ما حصلنا إجابة لهذا السؤال من المحل.")).toBeVisible();
  });
}

test("responsive request and candidate screens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/request");
    await expect(page.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toBeVisible();
    await expect(page.getByRole("button", { name: "اكتب طلبك", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));
    await page.getByRole("button", { name: /اسأل عني/ }).click();
    if (width === 768) await page.getByRole("button", { name: "تفعيل الوضع الفاتح" }).click();
    await page.screenshot({ path: `test-results/quick-request-${width}.png`, fullPage: true });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));
    await page.getByText("جرّب مثال الطباعة", { exact: true }).click();
    await page.getByRole("button", { name: "استخدم المثال" }).click();
    await page.getByRole("button", { name: "اعرض المحلات" }).click();
    await expect(page.getByRole("heading", { name: "من نَسأل عنك؟" })).toBeFocused();
    await page.screenshot({ path: `test-results/quick-candidates-${width}.png`, fullPage: true });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));
  }
});

test("editing a Quick Call preserves both questions and the selected area", async ({ page }) => {
  await page.goto("/request");
  await page.getByRole("button", { name: /اسأل عني/ }).click();
  await page.getByLabel("نوع المحل", { exact: true }).fill("محل طباعة");
  await page.getByLabel("الحي أو المدينة", { exact: true }).fill("العليا");
  await page.getByLabel("وش تبي نسأل المحل؟", { exact: true }).fill("تطبعون A2 اليوم؟");
  await page.getByRole("button", { name: "+ أضف سؤالاً ثانياً", exact: true }).click();
  await page.getByLabel("السؤال الثاني", { exact: true }).fill("كم سعر الطباعة؟");
  await page.getByRole("button", { name: "اعرض المحلات" }).click();
  await page.getByRole("button", { name: "تعديل الطلب" }).click();
  await expect(page.getByLabel("نوع المحل", { exact: true })).toHaveValue("محل طباعة");
  await expect(page.getByLabel("الحي أو المدينة", { exact: true })).toHaveValue("العليا");
  await expect(page.getByLabel("وش تبي نسأل المحل؟", { exact: true })).toHaveValue("تطبعون A2 اليوم؟");
  await expect(page.getByLabel("السؤال الثاني", { exact: true })).toHaveValue("كم سعر الطباعة؟");
  await page.getByRole("button", { name: "اعرض المحلات" }).click();
  await expect(page.getByRole("heading", { name: "من نَسأل عنك؟" })).toBeVisible();
});

test("tracks a newly created compare task after visiting Quick Call", async ({ page }) => {
  await chooseExample(page);
  await page.getByRole("button", { name: "اختر المحل مطبعة الحي التجريبية" }).click();
  await page.getByRole("link", { name: "ابدأ طلبك", exact: true }).click();
  await page.getByRole("button", { name: /قارن لي/ }).click();
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة جوالي");
  await page.getByRole("button", { name: "عبّئ التفاصيل", exact: true }).click();
  await page.getByLabel("نوع الجهاز").selectOption("آيفون");
  await page.getByLabel("الموديل").fill("15 برو");
  await page.getByLabel("نوع الصيانة").selectOption("تغيير شاشة");
  await page.getByLabel("الحي / المدينة").fill("الملقا");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await page.getByRole("link", { name: "طلبك الحالي", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تتبع طلبك", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "نتصل بهذا المحل؟" })).not.toBeVisible();
});

test("creates a stock-check request without repair details", async ({ page }) => {
  await page.goto("/request");
  await page.getByLabel("نوع الطلب", { exact: true }).selectOption("stock_check");
  await page.getByRole("button", { name: "عبّئ التفاصيل", exact: true }).click();
  await page.getByLabel("المنتج أو القطعة", { exact: true }).fill("آيفون 16");
  await page.getByLabel("الحي / المدينة").fill("الملقا");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page.getByRole("heading", { name: "تتبع طلبك", exact: true })).toBeVisible();
  await expect(page.getByText("المحلات المكتشفة: ١")).toBeVisible();
});
