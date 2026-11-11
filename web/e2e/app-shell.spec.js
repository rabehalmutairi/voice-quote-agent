import { expect, test } from "@playwright/test";

test("loads an Arabic RTL application shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar-SA");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: /من وصف المشكلة/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 16px "Noto Sans Arabic"'))).toBe(true);
  await expect(page.getByRole("complementary", { name: "تغيير شاشة آيفون ١٥ برو" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /دليل الحي.*الصفحة الرئيسية/ })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: /ابدأ طلبك/ }).first()).toHaveAttribute("href", "/request");
});

test("opens the preserved request workflow from the dedicated route", async ({ page }) => {
  await page.goto("/request");

  await expect(page.getByRole("heading", { name: "قارن عروض صيانة جوالك" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "السيناريو التجريبي" })).toHaveCount(0);
});

test("does not fabricate results on a direct tracking navigation", async ({ page }) => {
  await page.goto("/tracking");

  await expect(page.getByRole("heading", { name: "لا يوجد طلب متاح" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ابدأ طلباً جديداً" })).toHaveAttribute("href", "/request");
  await expect(page.getByText("صيانة السريع")).toHaveCount(0);
});
