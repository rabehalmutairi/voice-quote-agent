import { expect, test } from "@playwright/test";

test("keeps the internal dashboard usable without page overflow across target widths", async ({ page }) => {
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/metrics");

    await expect(page.getByRole("heading", { name: "لوحة المقاييس الداخلية" })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "ابدأ طلبك" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "طلبك الحالي" })).toHaveCount(0);
    await navigation.getByRole("link", { name: "ابدأ طلبك" }).click();
    await expect(page.getByRole("heading", { name: "قارن عروض صيانة جوالك" })).toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();
    await page.getByRole("navigation", { name: "أدوات المشروع" }).getByRole("link", { name: "لوحة المقاييس" }).click();
    await expect(page.getByRole("heading", { name: "لوحة المقاييس الداخلية" })).toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(dimensions.bodyScrollWidth, `page overflow at ${width}px: ${JSON.stringify(dimensions)}`)
      .toBeLessThanOrEqual(dimensions.viewport);
  }
});
