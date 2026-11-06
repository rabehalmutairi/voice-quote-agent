import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComparisonSummary } from "./ComparisonSummary";

const shops = {
  place_1: {
    placeId: "place_1",
    name: "محل الريان للجوالات",
    status: "ready",
    quote: { options: [{}] },
  },
  place_2: {
    placeId: "place_2",
    name: "مركز التقنية",
    status: "ready",
    quote: { options: [{}] },
  },
  place_3: { placeId: "place_3", name: "جوالك بلس" },
};

describe("ComparisonSummary", () => {
  it("presents the backend ranking when all offers share the comparison basis", () => {
    render(
      <ComparisonSummary
        comparison={{
          status: "ranked",
          basis: "قطعة تجارية مع الضمان",
          ranking: [
            { placeId: "place_2", rank: 2, reason: "أعلى سعراً" },
            { placeId: "place_1", rank: 1, reason: "أقل سعراً" },
          ],
          excluded: [],
          cannotCompareReasons: [],
        }}
        shops={shops}
      />,
    );

    expect(screen.getByText("العروض مرتبة")).toBeVisible();
    expect(screen.getByRole("list", { name: "ترتيب العروض" })).toBeVisible();
    expect(screen.getByText("أقل سعراً")).toBeVisible();
    expect(screen.getByText("أعلى سعراً")).toBeVisible();
  });

  it("explains a partial comparison and names excluded shops", () => {
    render(
      <ComparisonSummary
        comparison={{
          status: "partial",
          basis: "العروض التجارية مع الضمان",
          ranking: [{ placeId: "place_1", rank: 1, reason: "أقل سعر" }],
          excluded: [{ placeId: "place_3", reason: "لم يرد المحل" }],
          cannotCompareReasons: ["العرض الأصلي ليس مثل العرض التجاري."],
        }}
        shops={shops}
      />,
    );

    expect(screen.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
    expect(screen.getByText("مقارنة جزئية")).toBeVisible();
    expect(screen.getByText("العروض التجارية مع الضمان")).toBeVisible();
    expect(within(screen.getByRole("list", { name: "ترتيب العروض" })).getByText("محل الريان للجوالات")).toBeVisible();
    expect(screen.getByText("جوالك بلس: لم يرد المحل")).toBeVisible();
    expect(screen.getByText("العرض الأصلي ليس مثل العرض التجاري.")).toBeVisible();
  });

  it("states clearly when no fair ranking is available", () => {
    render(
      <ComparisonSummary
        comparison={{
          status: "cannot_compare",
          basis: "نوع القطعة والسعر",
          ranking: [],
          excluded: [],
          cannotCompareReasons: ["لم يذكر المحلان النوع نفسه."],
        }}
        shops={shops}
      />,
    );

    expect(screen.getByText("ما نقدر نقارن العروض بشكل عادل")).toBeVisible();
    expect(screen.getByText("لم يذكر المحلان النوع نفسه.")).toBeVisible();
    expect(screen.queryByRole("list", { name: "ترتيب العروض" })).not.toBeInTheDocument();
  });

  it("does not rank a known shop until its quote is ready", () => {
    render(
      <ComparisonSummary
        comparison={{
          status: "partial",
          basis: "السعر والضمان",
          ranking: [
            { placeId: "place_3", rank: 1, reason: "الأقل سعراً" },
            { placeId: "place_1", rank: 2, reason: "عرض مكتمل" },
          ],
          excluded: [],
          cannotCompareReasons: [],
        }}
        shops={shops}
      />,
    );

    expect(screen.getByRole("list", { name: "ترتيب العروض" })).toBeVisible();
    expect(screen.queryByText("جوالك بلس")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "ترتيب العروض" })).getByText("محل الريان للجوالات")).toBeVisible();
  });
});
