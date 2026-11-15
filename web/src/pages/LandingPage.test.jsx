import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("product introduction", () => {
  it("explains both modes with one clearly simulated example and a request action", () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("إلى إجابة واضحة.");
    expect(screen.getByText("معاينة محاكاة · ليست نتيجة اتصال حقيقي")).toBeVisible();
    expect(screen.getByText("عرض توضيحي واحد؛ لا يعني أنه الأرخص.")).toBeVisible();
    expect(screen.getByRole("complementary")).toHaveAccessibleName("تغيير شاشة آيفون ١٥ برو");
    expect(screen.getByRole("link", { name: "ابدأ طلبك" })).toHaveAttribute("href", "/request");
    expect(screen.getByText(/قارن عروض الصيانة، أو اسأل محلاً تختاره/)).toBeVisible();
  });

  it("lets the reader hide and reveal the sample evidence using a native disclosure", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const quote = screen.getByText("«التجاري بأربعمية وخمسين.»");
    expect(quote).toBeVisible();
    await user.click(screen.getByText("من وين جاء السعر؟"));
    expect(quote).not.toBeVisible();
    await user.click(screen.getByText("من وين جاء السعر؟"));
    expect(quote).toBeVisible();
  });
});
