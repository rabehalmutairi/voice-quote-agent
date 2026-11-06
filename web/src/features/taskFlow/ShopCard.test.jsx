import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShopCard } from "./ShopCard";

function readyShop() {
  return {
    placeId: "place_1",
    name: "محل تجريبي",
    status: "ready",
    quote: {
      options: [{
        partType: { value: "commercial", status: "found", evidenceQuote: "التجاري", evidenceTurn: 2 },
        priceSar: { value: 450, status: "found", evidenceQuote: "أربعمية وخمسين", evidenceTurn: 2 },
        warrantyDays: { status: "not_mentioned" },
      }],
      turnaroundMinutes: { value: 45, status: "found", evidenceQuote: "خمسة وأربعين دقيقة", evidenceTurn: 3 },
      availability: { status: "refused" },
      evidenceIssues: [],
    },
    transcript: [
      { i: 1, speaker: "agent", t: 0, text: "معك مساعد ذكاء اصطناعي." },
      { i: 2, speaker: "shop", t: 21, text: "التجاري بأربعمية وخمسين." },
      { i: 3, speaker: "shop", t: 30, text: "خمسة وأربعين دقيقة." },
    ],
  };
}

describe("ShopCard", () => {
  it("renders supported shop metadata and only exposes actions for real fields", () => {
    render(
      <ShopCard
        shop={{
          placeId: "place_1",
          name: "محل تجريبي",
          status: "discovered",
          phone_e164: "+966501234567",
          number_type: "mobile",
          address: "حي الملقا، الرياض",
          maps_url: "https://maps.google.com/?cid=fixture1",
          open_now: false,
          rating: 4.4,
        }}
      />,
    );

    expect(screen.getByText("حي الملقا، الرياض")).toBeVisible();
    expect(screen.getByText("٤٫٤ / ٥")).toBeVisible();
    expect(screen.getByText("mobile")).toBeVisible();
    expect(screen.getByText("مغلق الآن")).toBeVisible();

    expect(screen.queryByRole("link", { name: "اتصل بـ محل تجريبي" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "عرض موقع محل تجريبي على خرائط Google" })).toHaveAttribute(
      "href",
      "https://maps.google.com/?cid=fixture1",
    );
  });

  it("does not fabricate optional shop information or actions", () => {
    render(
      <ShopCard
        shop={{
          placeId: "place_1",
          name: "محل بدون بيانات إضافية",
          status: "discovered",
          maps_url: "https://example.com/not-a-map",
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: /اتصل/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /الخريطة/ })).not.toBeInTheDocument();
    expect(screen.queryByText("التقييم")).not.toBeInTheDocument();
    expect(screen.queryByText("نوع الرقم")).not.toBeInTheDocument();
    expect(screen.queryByText("مفتوح الآن")).not.toBeInTheDocument();
    expect(screen.queryByText("مغلق الآن")).not.toBeInTheDocument();
  });

  it("ignores malformed optional metadata and stays safe with an incomplete quote", () => {
    render(
      <ShopCard
        shop={{
          placeId: "place_1",
          name: "محل بياناته ناقصة",
          status: "ready",
          phone_e164: "javascript:alert(1)",
          rating: 8,
          open_now: "yes",
          quote: { options: [] },
        }}
      />,
    );

    expect(screen.getByText("وصل تحديث المحل، لكن بيانات العرض غير مكتملة لذلك لم نعرض تفاصيل غير مؤكدة.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /اتصل/ })).not.toBeInTheDocument();
    expect(screen.queryByText("التقييم")).not.toBeInTheDocument();
    expect(screen.queryByText("مفتوح الآن")).not.toBeInTheDocument();
    expect(screen.queryByText("العرض المستخرج")).not.toBeInTheDocument();
  });

  it("maps provider failure details to safe Arabic copy", () => {
    render(
      <ShopCard
        shop={{
          placeId: "place_1",
          name: "محل تجريبي",
          status: "failed",
          outcome: "no_answer",
          error: "provider secret: upstream timeout",
        }}
      />,
    );

    expect(screen.getByText("لم يرد المحل على الاتصال.")).toBeVisible();
    expect(screen.queryByText("provider secret: upstream timeout")).not.toBeInTheDocument();
  });

  it("shows quote evidence and opens the matching transcript turn", async () => {
    const user = userEvent.setup();
    render(<ShopCard shop={readyShop()} />);

    expect(screen.getByText("أربعمية وخمسين")).toBeVisible();
    expect(screen.getByText("٤٥٠ ريال")).toBeVisible();
    expect(screen.getByText("لم يذكر المحل هذه المعلومة.")).toBeVisible();
    expect(screen.getByText("المحل رفض إعطاء هذه المعلومة.")).toBeVisible();

    const evidenceButton = screen.getByRole(
      "button",
      { name: "عرض دليل السعر من محل تجريبي، الخيار ١" },
    );
    await user.click(evidenceButton);

    expect(screen.getByRole("dialog", { name: "دليل السعر" })).toBeVisible();
    expect(screen.getByText("التجاري بأربعمية وخمسين.")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(evidenceButton).toHaveFocus();
  });

  it.each([
    ["missing transcript turn", (shop) => {
      delete shop.quote.options[0].priceSar.evidenceTurn;
    }],
    ["mismatched quote text", (shop) => {
      shop.quote.options[0].priceSar.evidenceQuote = "سعر غير موجود";
    }],
    ["agent-speaker turn", (shop) => {
      shop.transcript[1].speaker = "agent";
    }],
  ])("does not present %s as verified evidence", (_description, mutate) => {
    const shop = readyShop();
    mutate(shop);
    render(<ShopCard shop={shop} />);

    expect(screen.queryByText("٤٥٠ ريال")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /عرض دليل السعر/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("لم نتمكن من التحقق من هذه المعلومة.").length).toBeGreaterThan(0);
  });
});
