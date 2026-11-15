import { expect, test } from "@playwright/test";

async function fillRepairDetails(page) {
  await page.getByRole("button", { name: "عبّئ التفاصيل", exact: true }).click();
  await page.getByLabel("نوع الجهاز").selectOption("آيفون");
  await page.getByLabel("الموديل").fill("15 برو");
  await page.getByLabel("نوع الصيانة").selectOption("تغيير شاشة");
  await page.getByLabel("الحي / المدينة").fill("حي الملقا");
}

test("keeps the repeatable demo visibly separate from production data", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "العرض التجريبي" })).toBeVisible();
  await expect(page.getByText("شغّل رحلة كاملة ببيانات محاكاة، بدون اتصال بالمحلات أو بيانات إنتاجية.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "العرض التجريبي", exact: true }).getByRole("note"),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "السيناريو التجريبي" })).toBeVisible();
});

test("shows the fixture metrics dashboard with accessible data alternatives", async ({ page }) => {
  await page.goto("/metrics");

  await expect(page.getByRole("heading", { name: "لوحة المقاييس الداخلية" })).toBeVisible();
  await expect(page.getByText("بيانات محاكاة فقط").first()).toBeVisible();
  await expect(page.getByText("هذه الأرقام توضيحية من بيانات محاكاة، وليست قياسات من الإنتاج.")).toBeVisible();
  await expect(page.getByRole("table", { name: "دقة الحقول الحرجة في بيانات المحاكاة" })).toBeVisible();
  await expect(page.getByRole("table", { name: "زمن كل مكالمة محاكاة" })).toBeVisible();
});

test("plays the complete demo journey through comparison and evidence", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByRole("heading", { name: "نتابع طلبك" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
  await expect(page.getByText("مقارنة جزئية")).toBeVisible();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "جوالك بلس" })).toBeVisible();

  await page.getByRole("button", { name: /عرض دليل السعر من/ }).first().click();
  await expect(page.getByRole("dialog", { name: "دليل السعر" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("أربعمية وخمسين.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("replays the demo with a different fixture scenario", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("combobox", { name: "السيناريو التجريبي" }).selectOption("cannot-compare");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByText("ما نقدر نقارن العروض بشكل عادل", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "ترتيب العروض" })).toHaveCount(0);

  await page.getByRole("button", { name: "ابدأ طلباً جديداً" }).click();
  await page.getByRole("combobox", { name: "السيناريو التجريبي" }).selectOption("foundation");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
  await expect(page.getByText("مقارنة جزئية")).toBeVisible();
});

test("completes the missing-input flow in the demo route", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("combobox", { name: "السيناريو التجريبي" }).selectOption("needs-input");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أصلح جوالي");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByRole("heading", { name: "نحتاج تفاصيل إضافية" })).toBeVisible();
  await page.getByRole("textbox", { name: "وش نوع الجهاز وموديله بالضبط؟" }).fill("iPhone 15 Pro");
  await page.getByRole("textbox", { name: "وين تبي المحلات تكون؟" }).fill("حي الملقا");
  await page.getByRole("button", { name: "متابعة البحث" }).click();

  await expect(page.getByRole("heading", { name: "نحتاج تفاصيل إضافية" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "جوالك بلس" })).toBeVisible();
  await expect(page.getByText("اكتملت النتائج جزئياً.").last()).toBeVisible();
});
