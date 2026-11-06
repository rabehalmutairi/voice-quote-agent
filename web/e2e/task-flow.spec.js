import { expect, test } from "@playwright/test";

test("completes missing information after creating a request from the product route", async ({ page }) => {
  await page.goto("/request");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة جوالي");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await page.getByRole("textbox", { name: /نوع الجهاز وموديله/ }).fill("آيفون 15 برو");
  await page.getByRole("textbox", { name: /وش تبي تصلّح/ }).fill("تغيير شاشة");
  await page.getByRole("textbox", { name: /وين تبي المحلات/ }).fill("الملقا");
  await page.getByRole("button", { name: "متابعة البحث" }).click();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "نحتاج تفاصيل إضافية" })).not.toBeVisible();
});

async function fillRepairDetails(page) {
  await page.getByRole("button", { name: "عبّئ التفاصيل", exact: true }).click();
  await page.getByLabel("نوع الجهاز").selectOption("آيفون");
  await page.getByLabel("الموديل").fill("15 برو");
  await page.getByLabel("نوع الصيانة").selectOption("تغيير شاشة");
  await page.getByLabel("الحي / المدينة").fill("حي الملقا");
}

test("plays the Arabic fixture task through three live shop cards", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByRole("heading", { name: "نتابع طلبك" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "جوالك بلس" })).toBeVisible();
  await expect(page.getByText("اكتملت النتائج جزئياً.").last()).toBeVisible();
  await expect(page.getByText("تعذر الاتصال").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
  await expect(page.getByText("مقارنة جزئية")).toBeVisible();

  await page.getByRole("button", { name: /عرض دليل السعر من/ }).first().click();
  await expect(page.getByRole("dialog", { name: "دليل السعر" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("أربعمية وخمسين.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("completes the reachable missing-information fixture journey", async ({ page }) => {
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

test("explains a cannot-compare fixture without inventing a ranking", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("combobox", { name: "السيناريو التجريبي" }).selectOption("cannot-compare");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();

  await expect(page.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
  await expect(page.getByText("ما نقدر نقارن العروض بشكل عادل", { exact: true })).toBeVisible();
  await expect(page.getByText("ما نقدر نرتب الأسعار بدون مقارنة النوع نفسه.")).toBeVisible();
  await expect(page.getByRole("list", { name: "ترتيب العروض" })).toHaveCount(0);
});

test("keeps one fixture task connected across tracking and comparison routes", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill("أبي أغير شاشة آيفون 15 برو");
  await fillRepairDetails(page);
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();

  await page.getByRole("link", { name: "طلبك الحالي", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تتبع طلبك" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
  await expect(page.getByText("صيانة السريع")).toHaveCount(0);

  await page.getByRole("link", { name: "مقارنة العروض" }).click();
  await expect(page.getByText("مقارنة جزئية")).toBeVisible();
  await expect(page.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
  await expect(page.getByText("الأفضل قيمة")).toHaveCount(0);
});
