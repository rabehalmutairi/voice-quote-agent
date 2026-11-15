import { expect, test } from "@playwright/test";
import path from "node:path";

const scenario = process.env.MOCK_SCENARIO || "default";
const fails = ["all_failed", "no_shops"].includes(scenario);
async function submitRepair(page, text = "أبي أغير شاشة آيفون 15 برو في الملقا") {
  await page.goto("/request");
  await page.getByRole("textbox", { name: "وش تبي تصلّح؟" }).fill(text);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/tasks") && response.request().method() === "POST");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  return (await response.json()).task_spec.task_id;
}

test(`renders the real mock API journey: ${scenario}`, async ({ page }, testInfo) => {
  const taskId = await submitRepair(page);
  await expect(page).toHaveURL(new RegExp(`/tracking\\?task=${taskId}$`));
  if (fails) {
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
    const snapshot = await (await page.request.get(`/api/tasks/${taskId}`)).json();
    for (const business of snapshot.businesses) await expect(page.getByRole("heading", { name: business.name, exact: true })).toBeVisible();
    if (scenario === "default" && process.env.VQA_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.VQA_CAPTURE_DIR, `tracking-${testInfo.project.name}.png`), fullPage: true });
    await page.getByRole("link", { name: "عرض النتيجة", exact: true }).click();
    await expect(page.getByRole("heading", { name: "نتيجة المهمة", exact: true })).toBeVisible();
    await expect(page.getByText(scenario === "one_failed" ? "مقارنة جزئية" : "العروض مرتبة حسب نتيجة المهمة", { exact: true })).toBeVisible();
    if (scenario === "default" && process.env.VQA_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.VQA_CAPTURE_DIR, `comparison-${testInfo.project.name}.png`), fullPage: true });
    expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
    await page.getByRole("button", { name: /عرض دليل السعر/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator('[aria-current="true"]')).toBeVisible();
    await page.keyboard.press("Escape");
    const starts = [];
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/start")) starts.push(request.url()); });
    await page.reload();
    await expect(page.getByRole("heading", { name: "نتيجة المهمة", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /عرض دليل السعر/ }).first().click();
    await expect(page.getByRole("dialog").locator('[aria-current="true"]')).toBeVisible();
    expect(starts).toHaveLength(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("asks again for unresolved input without starting and then completes", async ({ page }) => {
  test.skip(scenario !== "default");
  const starts = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/start")) starts.push(request.url()); });
  await submitRepair(page, "أبي أغير شاشة آيفون 15 برو");
  await page.getByRole("textbox", { name: /وين تبي المحلات/ }).fill("حي غير معروف");
  await page.getByRole("button", { name: "متابعة البحث" }).click();
  await expect(page.getByRole("heading", { name: "نحتاج تفاصيل إضافية" })).toBeVisible();
  expect(starts).toHaveLength(0);
  await page.getByRole("textbox", { name: /وين تبي المحلات/ }).fill("حي الملقا");
  await page.getByRole("button", { name: "متابعة البحث" }).click();
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  expect(starts).toHaveLength(1);
});

test("restores after network loss following accepted Start without another Start", async ({ page, context }) => {
  test.skip(scenario !== "default");
  const starts = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/start")) starts.push(request.url()); });
  const started = page.waitForResponse((response) => response.url().endsWith("/start") && response.status() === 202);
  await submitRepair(page);
  await started;
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "إعادة الاتصال", exact: true })).toBeVisible({ timeout: 20000 });
  await context.setOffline(false);
  await page.getByRole("button", { name: "إعادة الاتصال", exact: true }).click();
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  expect(starts).toHaveLength(1);
});

test("handles an unknown saved task without creating a replacement", async ({ page }) => {
  test.skip(scenario !== "default");
  const mutations = [];
  page.on("request", (request) => { if (request.method() === "POST") mutations.push(request.url()); });
  await page.goto("/tracking?task=tsk_unknown123");
  await expect(page.getByText(/لم نجد هذا الطلب/)).toBeVisible();
  expect(mutations).toHaveLength(0);
});

async function navigateWithinApp(page, pathname) {
  await page.evaluate((url) => {
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, pathname);
}

test("does not show or reconnect A when restoring B fails", async ({ page }) => {
  test.skip(scenario !== "default");
  await submitRepair(page);
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  await navigateWithinApp(page, "/tracking?task=tsk_unknown123");
  await expect(page.getByText(/لم نجد هذا الطلب/)).toBeVisible();
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toHaveCount(0);
  const recovery = page.waitForRequest((request) => request.method() === "GET" && request.url().endsWith("/api/tasks/tsk_unknown123"));
  await page.getByRole("button", { name: "إعادة الاتصال", exact: true }).click();
  await recovery;
  await expect(page.getByText(/لم نجد هذا الطلب/)).toBeVisible();
});

test("an explicit saved task URL takes precedence over the local demo", async ({ page }) => {
  test.skip(scenario !== "default");
  const taskId = await submitRepair(page);
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  await navigateWithinApp(page, "/demo");
  await page.getByRole("button", { name: "استخدم مثالًا تجريبيًا" }).click();
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page.getByRole("heading", { name: "نتابع طلبك" })).toBeVisible();
  await navigateWithinApp(page, `/tracking?task=${taskId}`);
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  await expect(page.locator(".reference-tracking__context")).toContainText("أبي أغير شاشة آيفون 15 برو في الملقا");
  await expect(page.getByText("المصدر: محاكاة الخادم", { exact: true })).toHaveCount(1);
});

test("stock checks use the backend category and preserve offer details", async ({ page }) => {
  test.skip(scenario !== "default");
  await page.goto("/request");
  await page.getByLabel("نوع الطلب").selectOption("stock_check");
  await page.getByRole("button", { name: "استخدم مثالًا تجريبيًا" }).click();
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  const taskId = new URL(page.url()).searchParams.get("task");
  const snapshot = await (await page.request.get(`/api/tasks/${taskId}`)).json();
  expect(snapshot.task_spec.category).toBe("stock_check");
  await page.getByRole("link", { name: "عرض النتيجة", exact: true }).click();
  await expect(page.getByText("حالة المنتج", { exact: true }).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("NaN");
});

test("saved task navigation takes precedence over a Quick Call preview", async ({ page }) => {
  test.skip(scenario !== "default");
  const taskId = await submitRepair(page);
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  await navigateWithinApp(page, "/request");
  await page.getByRole("button", { name: /اسأل عني/ }).click();
  await page.getByText("جرّب مثال الطباعة", { exact: true }).click();
  await page.getByRole("button", { name: "استخدم المثال" }).click();
  await page.getByRole("button", { name: "اعرض المحلات" }).click();
  await expect(page.getByRole("heading", { name: "من نَسأل عنك؟" })).toBeVisible();
  await navigateWithinApp(page, `/tracking?task=${taskId}`);
  await expect(page.getByRole("link", { name: "عرض النتيجة", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "من نَسأل عنك؟" })).toHaveCount(0);
});

test("populated backend results reflow in both themes and at large text", async ({ page }, testInfo) => {
  test.skip(scenario !== "default" || testInfo.project.name !== "api-desktop");
  await submitRepair(page);
  await page.getByRole("link", { name: "عرض النتيجة", exact: true }).click();
  for (const width of [320, 375, 768, 1024, 1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 768) await page.getByRole("button", { name: "تفعيل الوضع الفاتح" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: /عرض دليل السعر/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
