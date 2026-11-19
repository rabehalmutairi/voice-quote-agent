import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

function renderLanding() {
  return render(<MemoryRouter><LandingPage /></MemoryRouter>);
}

describe("product introduction", () => {
  it("explains both modes, labels the demo as simulated and offers a request action", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("خلّ الجواب يجيك.");
    expect(screen.getByText(/قارن عروض الصيانة، أو اسأل محلاً تختاره/)).toBeVisible();
    expect(screen.getByText(/ولا ينفّذ اتصالات حقيقية/)).toBeVisible();
    expect(screen.getByText("مشهد توضيحي · بيانات تجريبية")).toBeVisible();
    expect(screen.getByText(/لا يعني أنه الأرخص/)).toBeVisible();
    for (const link of screen.getAllByRole("link", { name: "ابدأ طلبك" })) {
      expect(link).toHaveAttribute("href", "/request");
    }
  });

  it("keeps the section ids that /how-it-works and /about redirect to", () => {
    const { container } = renderLanding();
    expect(container.querySelector("#how-it-works")).not.toBeNull();
    expect(container.querySelector("#about")).not.toBeNull();
    expect(screen.getByRole("link", { name: /شوف كيف تشتغل/ })).toHaveAttribute("href", "#how-it-works");
  });

  it("moves through the journey steps with the step buttons and arrows", async () => {
    const user = userEvent.setup();
    renderLanding();
    const demo = screen.getByRole("region", { name: "جرب رحلة الطلب" });
    expect(within(demo).getByRole("heading", { level: 3 })).toHaveTextContent("قل وش تحتاج");
    expect(within(demo).getByRole("button", { name: "الخطوة السابقة" })).toBeDisabled();

    await user.click(within(demo).getByRole("button", { name: "الخطوة 3: نسأل المحلات" }));
    expect(within(demo).getByRole("heading", { level: 3 })).toHaveTextContent("نسأل المحلات");

    await user.click(within(demo).getByRole("button", { name: "الخطوة التالية" }));
    expect(within(demo).getByRole("heading", { level: 3 })).toHaveTextContent("توصلك الردود");
    expect(within(demo).getByText("الخطوة 4 من 5")).toBeVisible();
  });

  it("shows the shop's own words for the chosen detail", async () => {
    const user = userEvent.setup();
    renderLanding();
    const evidence = screen.getByRole("region", { name: /ما نكتفي بالسعر/ });
    expect(within(evidence).getByText("«التجاري بأربعمية وخمسين.»")).toBeVisible();

    await user.click(within(evidence).getByRole("button", { name: "الضمان" }));
    expect(within(evidence).getByRole("button", { name: "الضمان" })).toHaveAttribute("aria-pressed", "true");
    expect(within(evidence).getByText("«وعليها ضمان ثلاثين يوم.»")).toBeVisible();
    expect(within(evidence).queryByText("«التجاري بأربعمية وخمسين.»")).toBeNull();
  });
});
