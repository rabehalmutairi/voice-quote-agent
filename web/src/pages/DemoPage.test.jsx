import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoPage } from "./DemoPage";

describe("DemoPage", () => {
  it("explains that the repeatable journey uses fixtures only", async () => {
    render(<DemoPage />);

    expect(screen.getByRole("heading", { level: 1, name: "العرض التجريبي" })).toBeVisible();
    expect(screen.getByText("شغّل رحلة كاملة ببيانات محاكاة، بدون اتصال بالمحلات أو بيانات إنتاجية.")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "السيناريو التجريبي" })).toBeVisible();
    await userEvent.click(screen.getAllByText("بيانات محاكاة فقط")[0]);
    expect(screen.getByText("هذه الرحلة لا تمثل أداء النظام في الإنتاج.")).toBeVisible();
  });
});
