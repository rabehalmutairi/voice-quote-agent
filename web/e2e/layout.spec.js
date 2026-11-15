import { expect, test } from "@playwright/test";

const widths = [320, 375, 768, 1024, 1440, 1920, 2560];

async function checkReflow(page, width) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
}

test("landing and request layouts adapt from phones to ultrawide screens", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/");
    if (width === 375) {
      await page.getByRole("button", { name: "تفعيل الوضع الفاتح" }).click();
      await expect(page.locator(".landing-hero")).toHaveCSS("background-image", "none");
    }
    await checkReflow(page, width);
    const title = page.locator("#landing-title");
    await expect(title).toBeVisible();
    if (width >= 1440) expect((await title.boundingBox()).height).toBeLessThan(310);
    await page.goto("/request");
    await checkReflow(page, width);
    const intro = await page.locator(".task-entry__intro").boundingBox();
    const form = await page.locator(".request-form").boundingBox();
    if (width >= 1440) {
      expect((await page.locator(".task-entry").boundingBox()).width).toBeGreaterThan(1000);
      expect(intro.x).toBeGreaterThan(form.x + form.width - 1);
    } else if (width <= 1024) expect(form.y).toBeGreaterThan(intro.y + intro.height - 1);
    await page.getByRole("button", { name: /اسأل عني/ }).click();
    await checkReflow(page, width);
    const header = await page.locator(".inquiry-form header").boundingBox();
    const fields = await page.locator(".inquiry-fields").boundingBox();
    if (width >= 1440) expect(header.x).toBeGreaterThan(fields.x + fields.width - 1);
    if (width <= 767) expect(fields.y).toBeGreaterThan(header.y + header.height - 1);
    await expect(page.getByRole("button", { name: "اعرض المحلات" })).toBeVisible();
    const actionSize = await page.getByRole("button", { name: "اعرض المحلات" }).evaluate((button) => parseFloat(getComputedStyle(button).fontSize));
    expect(actionSize).toBeGreaterThanOrEqual(14);
  }
});

test("content reflows with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/request");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await checkReflow(page, 768);
  await page.getByRole("button", { name: /اسأل عني/ }).click();
  await checkReflow(page, 768);
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await checkReflow(page, 768);
});

test("populated comparison cards stay readable on mobile in both themes", async ({ page }) => {
  await page.goto("/request");
  await page.getByRole("button", { name: "عبّئ التفاصيل", exact: true }).click();
  await page.getByLabel("نوع الجهاز", { exact: true }).selectOption("آيفون");
  await page.getByLabel("الموديل", { exact: true }).fill("15 برو");
  await page.getByLabel("نوع الصيانة", { exact: true }).selectOption("تغيير شاشة");
  await page.getByLabel("الحي / المدينة", { exact: true }).fill("الملقا");
  await page.getByRole("button", { name: "ابدأ البحث عن العروض" }).click();
  await expect(page.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
  await page.getByRole("link", { name: "مقارنة العروض", exact: true }).click();
  await expect(page.locator(".reference-offer-card").first()).toBeVisible();
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "تفعيل الوضع الفاتح" }).click();
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const card = await page.locator(".reference-offer-card").first().boundingBox();
      if (width < 768) expect(card.width).toBeGreaterThan(width * .8);
      const font = await page.locator(".reference-evidence-link").first().evaluate((button) => parseFloat(getComputedStyle(button).fontSize));
      expect(font).toBeLessThanOrEqual(18);
      await expect(page.getByRole("button", { name: /تفعيل الوضع/ })).toBeInViewport();
      await checkReflow(page, width);
    }
  }
});
